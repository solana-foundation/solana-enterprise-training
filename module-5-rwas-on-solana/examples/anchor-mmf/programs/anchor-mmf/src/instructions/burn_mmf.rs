use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{burn, Burn},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED, TIMELOCK_BURN},
    error::MmfError,
    state::{
        Config, Role, TimeLock, TimeLockOperation, TimeLockStatus,
        ROLE_EMERGENCY, ROLE_MINTER,
    },
};

/// Burn MMF from a holder's token account as part of a redemption flow.
///
/// Maps to the EVM's three-phase burn pattern:
///   `BurnPreparableFacet` → `BurnRespondableFacet` → `BurnableFacet`
///
/// On Solana, phases 1 and 2 are handled by the generic timelock
/// instructions (`create_timelock_proposal` with `Burn` operation,
/// then `respond_timelock_proposal`). This instruction is phase 3:
/// it validates the timelock, checks the delay, and executes the burn.
///
/// **Normal path** — `timelock` is `Some`. Requires `ROLE_MINTER` and
/// an accepted timelock with `TIMELOCK_BURN` delay elapsed. The holder
/// must also sign, authorizing the redemption.
///
/// **Emergency path** — `timelock` is `None`. Requires `ROLE_EMERGENCY`.
/// Used for operational scenarios where a burn must happen immediately
#[derive(Accounts)]
pub struct BurnMmf<'info> {
    pub minter: Signer<'info>,

    /// Holder must sign to authorize the burn in the happy path.
    pub holder: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ MmfError::Paused,
        has_one = mint @ MmfError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ROLE_SEED, role.role.as_ref(), minter.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub timelock: Option<Account<'info, TimeLock>>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = holder,
    )]
    pub holder_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<BurnMmf>, amount: u64) -> Result<()> {
    require!(amount > 0, MmfError::ZeroAmount);

    let role = &ctx.accounts.role;

    match &mut ctx.accounts.timelock {
        Some(timelock) => {
            require!(role.role == ROLE_MINTER, MmfError::MissingRole);
            require!(
                timelock.operation == TimeLockOperation::Burn,
                MmfError::TimelockMismatch
            );
            require!(
                timelock.status == TimeLockStatus::Accepted,
                MmfError::TimelockNotReady
            );

            let now = Clock::get()?.unix_timestamp;
            require!(
                now >= timelock.timestamp + TIMELOCK_BURN,
                MmfError::TimelockNotReady
            );

            // Bind execution to the accepted proposal: the holder ATA and
            // amount must match what was approved.
            let expected =
                TimeLock::encode_burn(&ctx.accounts.holder_ata.key(), amount);
            timelock.verify_action_data(&expected)?;

            timelock.status = TimeLockStatus::Executed;
            timelock.executer = Some(ctx.accounts.minter.key());
        }
        None => {
            require!(
                role.role == ROLE_EMERGENCY,
                MmfError::EmergencyRoleRequired
            );
        }
    }

    let cpi = CpiContext::new(
        ctx.accounts.token_program.key(),
        Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.holder_ata.to_account_info(),
            authority: ctx.accounts.holder.to_account_info(),
        },
    );
    burn(cpi, amount)?;

    msg!("burned {} MMF from {}", amount, ctx.accounts.holder.key());
    
    Ok(())
}
