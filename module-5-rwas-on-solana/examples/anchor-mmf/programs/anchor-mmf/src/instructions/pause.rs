use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenInterface};
use anchor_spl::token_2022::spl_token_2022::extension::pausable::instruction as pausable_instruction;

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED, TIMELOCK_PAUSE},
    error::MmfError,
    state::{
        Config, Role, TimeLock, TimeLockOperation, TimeLockStatus,
        ROLE_EMERGENCY, ROLE_PAUSER,
    },
};

/// Pause or resume the mint at the Token-2022 protocol level. Two paths:
///
/// **Normal path** — `timelock` is `Some`. Requires `ROLE_PAUSER` and
/// an accepted timelock with `TIMELOCK_PAUSE` delay elapsed.
///
/// **Emergency path** — `timelock` is `None`. Requires `ROLE_EMERGENCY`.
/// This is the critical path: during an active exploit you need to pause
/// transfers in the same block, not wait 6 hours.
///
/// This drives the Token-2022 **Pausable** extension via a CPI signed by the
/// Config PDA (the mint's pause authority). When paused, Token-2022 itself
/// rejects every transfer, mint, and burn of the mint - including
/// permanent-delegate moves, so `force_transfer` / `force_burn` are also
/// halted. To seize during an incident, resume, act, then re-pause. Thawing
/// (owned by the external Token ACL) is unaffected. `Config.paused` is kept as
/// a cached mirror for off-chain readers; the protocol is the source of truth.
#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub pauser: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint @ MmfError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ROLE_SEED, role.role.as_ref(), pauser.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
        constraint = role.grantee == pauser.key() @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub timelock: Option<Account<'info, TimeLock>>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    let role = &ctx.accounts.role;

    match &mut ctx.accounts.timelock {
        Some(timelock) => {
            require!(role.role == ROLE_PAUSER, MmfError::MissingRole);
            require!(
                timelock.operation == TimeLockOperation::Pause,
                MmfError::TimelockMismatch
            );
            require!(
                timelock.status == TimeLockStatus::Accepted,
                MmfError::TimelockNotReady
            );

            let now = Clock::get()?.unix_timestamp;
            require!(
                now >= timelock.timestamp + TIMELOCK_PAUSE,
                MmfError::TimelockNotReady
            );

            // Bind execution to the accepted proposal: the target pause state
            // must match what was approved.
            timelock.verify_action_data(&TimeLock::encode_pause(paused))?;

            timelock.status = TimeLockStatus::Executed;
            timelock.executer = Some(ctx.accounts.pauser.key());
        }
        None => {
            require!(
                role.role == ROLE_EMERGENCY,
                MmfError::EmergencyRoleRequired
            );
        }
    }

    // Drive the Token-2022 Pausable extension, signed by the Config PDA (the
    // mint's pause authority).
    let bump = [ctx.accounts.config.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];
    let token_program_id = ctx.accounts.token_program.key();
    let mint_key = ctx.accounts.mint.key();

    let ix = if paused {
        pausable_instruction::pause(&token_program_id, &mint_key, &ctx.accounts.config.key(), &[])?
    } else {
        pausable_instruction::resume(&token_program_id, &mint_key, &ctx.accounts.config.key(), &[])?
    };
    invoke_signed(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    // Cached mirror for off-chain readers; the protocol enforces the pause.
    ctx.accounts.config.paused = paused;
    ctx.accounts.config.version = ctx.accounts.config.version.saturating_add(1);
    msg!("MMF paused={}", paused);

    Ok(())
}
