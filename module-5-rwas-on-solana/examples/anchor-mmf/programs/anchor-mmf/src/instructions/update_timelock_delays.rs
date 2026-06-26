use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, MAX_TIMELOCK_DELAY, MIN_TIMELOCK_DELAY},
    error::MmfError,
    events::TimelockDelaysUpdated,
    state::{Config, TimeLock, TimeLockOperation, TimeLockStatus, TimelockDelays},
};

/// Re-tune the per-operation timelock delays stored on `Config`.
///
/// Admin-gated and itself timelocked under `Config.delays.update_delays`,
/// so a captured admin signer cannot shrink delays instantly and rush other
/// privileged actions through. The proposal's encoded `action_data` must
/// match the new delays exactly (via `TimeLock::encode_update_delays`),
/// preventing a responder-approved set of values from being executed with
/// different numbers later.
///
/// No emergency path. Aligned with the rest of the program: every privileged
/// action goes through the maker/checker timelock.
#[event_cpi]
#[derive(Accounts)]
pub struct UpdateTimelockDelays<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ MmfError::NotAdmin,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub timelock: Account<'info, TimeLock>,
}

fn require_in_range(delay: i64) -> Result<()> {
    require!(
        (MIN_TIMELOCK_DELAY..=MAX_TIMELOCK_DELAY).contains(&delay),
        MmfError::InvalidTimelockDelay
    );
    Ok(())
}

pub fn handler(ctx: Context<UpdateTimelockDelays>, new_delays: TimelockDelays) -> Result<()> {
    // Bounds-check every field before touching state. A negative delay would
    // make the next timelocked action ready immediately; an absurdly large
    // delay could overflow the timestamp arithmetic at execution time and
    // brick the operation.
    require_in_range(new_delays.set_role)?;
    require_in_range(new_delays.force_action)?;
    require_in_range(new_delays.burn)?;
    require_in_range(new_delays.ownership_transfer)?;
    require_in_range(new_delays.update_delays)?;

    let timelock = &mut ctx.accounts.timelock;

    require!(
        timelock.operation == TimeLockOperation::UpdateDelays,
        MmfError::TimelockMismatch
    );
    require!(
        timelock.status == TimeLockStatus::Accepted,
        MmfError::TimelockNotReady
    );

    let now = Clock::get()?.unix_timestamp;
    let ready_at = timelock
        .timestamp
        .checked_add(ctx.accounts.config.delays.update_delays)
        .ok_or(MmfError::TimelockOverflow)?;
    require!(now >= ready_at, MmfError::TimelockNotReady);

    // Bind execution to the approved values.
    let expected = TimeLock::encode_update_delays(
        new_delays.set_role,
        new_delays.force_action,
        new_delays.burn,
        new_delays.ownership_transfer,
        new_delays.update_delays,
    );
    timelock.verify_action_data(&expected)?;

    timelock.status = TimeLockStatus::Executed;
    timelock.executer = Some(ctx.accounts.admin.key());

    let previous_delays = ctx.accounts.config.delays;
    ctx.accounts.config.delays = new_delays;
    ctx.accounts.config.version = ctx.accounts.config.version.saturating_add(1);

    emit_cpi!(TimelockDelaysUpdated {
        previous_delays,
        new_delays,
        admin: ctx.accounts.admin.key(),
        timestamp: now,
    });

    msg!(
        "timelock delays updated: set_role={}, force_action={}, burn={}, ownership_transfer={}, update_delays={}",
        new_delays.set_role,
        new_delays.force_action,
        new_delays.burn,
        new_delays.ownership_transfer,
        new_delays.update_delays,
    );
    Ok(())
}
