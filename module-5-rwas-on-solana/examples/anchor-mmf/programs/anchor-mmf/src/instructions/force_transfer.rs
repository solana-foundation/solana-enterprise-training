use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{transfer_checked, TransferChecked},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED, TIMELOCK_FORCE_ACTION},
    error::MmfError,
    state::{
        Config, Role, TimeLock, TimeLockOperation, TimeLockStatus,
        ROLE_COMPLIANCE_DELEGATE, ROLE_EMERGENCY,
    },
};

/// Compliance-driven forced transfer. Two paths:
///
/// **Normal path** — `timelock` is `Some`. The delegate holds
/// `ROLE_COMPLIANCE_DELEGATE`, the timelock must be `Accepted` with
/// operation `ForceTransfer`, and the delay must have elapsed.
///
/// **Emergency path** — `timelock` is `None`. The delegate holds
/// `ROLE_EMERGENCY`. No delay — used during active incidents.
///
/// On Ethereum the Diamond operator has implicit authority to move
/// tokens — no dedicated facet needed. On Solana, Token-2022 doesn't
/// grant that power to the mint authority, so we need the
/// `PermanentDelegate` extension. The Config PDA is the mint's
/// permanent delegate, so Token-2022 will authorize the move from
/// any holder ATA.
///
/// ### Re-entrancy note
/// `transfer_checked` fires the hook, which CPIs to
/// `mmf_transfer_hook`. Splitting the hook into its own program
/// makes re-entrancy impossible here.
#[derive(Accounts)]
pub struct ForceTransfer<'info> {
    pub delegate: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint @ MmfError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ROLE_SEED, role.role.as_ref(), delegate.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub timelock: Option<Account<'info, TimeLock>>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Source ATA. *Any* holder ATA is accepted — the Config PDA is the
    /// mint's permanent delegate.
    #[account(mut, token::mint = mint)]
    pub from_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = mint)]
    pub to_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ForceTransfer>, amount: u64) -> Result<()> {
    require!(amount > 0, MmfError::ZeroAmount);

    let role = &ctx.accounts.role;

    match &mut ctx.accounts.timelock {
        Some(timelock) => {
            if role.role != ROLE_EMERGENCY {
                require!(
                    role.role == ROLE_COMPLIANCE_DELEGATE,
                    MmfError::MissingRole
                );
                require!(
                    timelock.operation == TimeLockOperation::ForceTransfer,
                    MmfError::TimelockMismatch
                );
                require!(
                    timelock.status == TimeLockStatus::Accepted,
                    MmfError::TimelockNotReady
                );

                let now = Clock::get()?.unix_timestamp;
                require!(
                    now >= timelock.timestamp + TIMELOCK_FORCE_ACTION,
                    MmfError::TimelockNotReady
                );

                // Bind execution to the accepted proposal: the source ATA,
                // destination ATA, and amount must match what was approved.
                let expected = TimeLock::encode_force_transfer(
                    &ctx.accounts.from_ata.key(),
                    &ctx.accounts.to_ata.key(),
                    amount,
                );
                timelock.verify_action_data(&expected)?;
            }

            timelock.status = TimeLockStatus::Executed;
            timelock.executer = Some(ctx.accounts.delegate.key());
        }
        None => {
            require!(
                role.role == ROLE_EMERGENCY,
                MmfError::EmergencyRoleRequired
            );
        }
    }

    let bump = [ctx.accounts.config.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        TransferChecked {
            from: ctx.accounts.from_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.to_ata.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        },
        signer_seeds,
    );
    transfer_checked(cpi, amount, ctx.accounts.mint.decimals)?;

    msg!(
        "force-transferred {} units from {} to {}",
        amount,
        ctx.accounts.from_ata.key(),
        ctx.accounts.to_ata.key()
    );
    Ok(())
}
