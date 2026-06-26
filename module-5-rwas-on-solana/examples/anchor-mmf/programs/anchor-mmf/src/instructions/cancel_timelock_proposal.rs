use anchor_lang::prelude::*;

use crate::{
    constants::CONFIG_SEED,
    error::MmfError,
    events::TimelockProposalCancelled,
    state::{Config, TimeLock, TimeLockStatus},
};

/// Cancel a pending or accepted timelock proposal. Two paths:
///
/// **Proposer cancel.** The proposer can cancel any proposal they created
/// while it is still `Proposed` or `Accepted`. Useful when the proposer
/// realizes the parameters were wrong, the off-chain context has shifted,
/// or a responder has accepted a proposal that turned out to be stale.
///
/// **Admin cancel.** The program admin can cancel any proposal as an
/// override path - for example when a responder is offline or a proposal
/// must demonstrably not execute even though the action_data binding
/// would not let it execute incorrectly. Sets the status to `Cancelled`
/// (which `TimeLockStatus` already has but nothing else writes).
///
/// On cancellation the PDA is closed and the rent flows back to the
/// proposer, who paid for it at creation time.
#[event_cpi]
#[derive(Accounts)]
pub struct CancelTimeLockProposal<'info> {
    /// Either the original proposer or the program admin. The handler
    /// branches on which one and applies the matching rule.
    pub signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    /// The timelock to cancel. Closed to the original proposer at the end
    /// of the handler so the rent flows back to whoever paid for it in
    /// `create_timelock_proposal`.
    #[account(
        mut,
        close = proposer,
    )]
    pub timelock: Account<'info, TimeLock>,

    /// CHECK: must match `timelock.proposer`. Used as the close target so
    /// rent flows back to whoever paid for the proposal PDA. The constraint
    /// is enforced in the handler.
    #[account(mut)]
    pub proposer: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<CancelTimeLockProposal>) -> Result<()> {
    let timelock = &mut ctx.accounts.timelock;
    let signer = ctx.accounts.signer.key();
    let admin = ctx.accounts.config.admin;

    // close = proposer routes rent back to whoever paid; enforce the link.
    require!(
        ctx.accounts.proposer.key() == timelock.proposer,
        MmfError::TimelockMismatch
    );

    // Either path: signer must be the proposer or the admin.
    let is_proposer = signer == timelock.proposer;
    let is_admin = signer == admin;
    require!(is_proposer || is_admin, MmfError::NotAdmin);

    // Must still be cancellable. Executed and Cancelled are terminal.
    require!(
        matches!(
            timelock.status,
            TimeLockStatus::Proposed | TimeLockStatus::Accepted
        ),
        MmfError::TimelockAlreadyFinalized
    );

    timelock.status = TimeLockStatus::Cancelled;

    let admin_override = is_admin && !is_proposer;
    emit_cpi!(TimelockProposalCancelled {
        proposal: timelock.key(),
        proposer: timelock.proposer,
        signer,
        admin_override,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "timelock proposal cancelled by {} (proposer={}, admin_path={})",
        signer,
        timelock.proposer,
        admin_override,
    );
    Ok(())
}
