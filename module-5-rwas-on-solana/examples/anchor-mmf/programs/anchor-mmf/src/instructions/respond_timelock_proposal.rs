use anchor_lang::prelude::*;

use crate::{
    constants::ROLE_SEED,
    error::MmfError,
    state::{Role, TimeLock, TimeLockStatus, ROLE_RESPONDER},
};

/// Approve a pending timelock proposal. Requires `ROLE_RESPONDER`.
///
/// The responder must be a different entity than the proposer,
/// enforcing the maker/checker separation required by the EVM
/// Diamond's timelockable facets. On acceptance, the timestamp is
/// updated to `now` and the per-operation delay is measured from this
/// moment, not from the original proposal creation.
#[derive(Accounts)]
pub struct RespondToTimeLockProposal<'info> {
    pub responder: Signer<'info>,

    #[account(
        seeds = [ROLE_SEED, ROLE_RESPONDER.as_ref(), responder.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
        constraint = role.role == ROLE_RESPONDER @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub timelock: Account<'info, TimeLock>,
}

pub fn handler(ctx: Context<RespondToTimeLockProposal>) -> Result<()> {
    // Must still be in Proposed state.
    require!(
        ctx.accounts.timelock.status == TimeLockStatus::Proposed,
        MmfError::TimelockAlreadyFinalized
    );

    // Responder cannot be the proposer.
    require!(
        ctx.accounts.responder.key() != ctx.accounts.timelock.proposer,
        MmfError::TimelockSelfResponse
    );

    ctx.accounts.timelock.responder = Some(ctx.accounts.responder.key());
    ctx.accounts.timelock.status = TimeLockStatus::Accepted;
    
    // Reset timestamp to now — the delay clock starts here.
    ctx.accounts.timelock.timestamp = Clock::get()?.unix_timestamp;

    msg!(
        "timelock proposal accepted by {}",
        ctx.accounts.responder.key()
    );
    Ok(())
}
