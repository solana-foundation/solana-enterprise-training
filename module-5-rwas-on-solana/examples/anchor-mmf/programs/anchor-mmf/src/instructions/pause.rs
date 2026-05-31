use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED, TIMELOCK_PAUSE},
    error::MmfError,
    state::{
        Config, Role, TimeLock, TimeLockOperation, TimeLockStatus,
        ROLE_EMERGENCY, ROLE_PAUSER,
    },
};

/// Flip the global pause flag. Two paths:
///
/// **Normal path** — `timelock` is `Some`. Requires `ROLE_PAUSER` and
/// an accepted timelock with `TIMELOCK_PAUSE` delay elapsed.
///
/// **Emergency path** — `timelock` is `None`. Requires `ROLE_EMERGENCY`.
/// This is the critical path: during an active exploit you need to pause
/// transfers in the same block, not wait 6 hours.
///
/// When `paused == true`, the admin program refuses to mint or burn. It does
/// not gate thawing - that is owned by the external Token ACL (pause it there
/// if needed). The rate-limit transfer hook does not read this flag either -
/// to halt an already-thawed holder during an incident, compliance adds them
/// to the ABL block list (or freezes via Token ACL's permissionless freeze).
#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub pauser: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
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

    ctx.accounts.config.paused = paused;
    ctx.accounts.config.version = ctx.accounts.config.version.saturating_add(1);
    msg!("MMF paused={}", paused);
    
    Ok(())
}
