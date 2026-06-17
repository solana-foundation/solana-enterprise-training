use anchor_lang::prelude::*;

use crate::{
    constants::{ANCHOR_DISCRIMINATOR_SIZE, ROLE_SEED},
    error::MmfError,
    state::{
        Role, TimeLock, TimeLockOperation, TimeLockStatus,
        ROLE_COMPLIANCE_DELEGATE, ROLE_MINTER, ROLE_PAUSER,
    },
};

/// Create a timelock proposal for any timelockable operation.
///
/// The proposer must hold the role appropriate for the operation:
///   - `Pause`             → `ROLE_PAUSER`
///   - `SetRole`           → admin (checked via Config, not role PDA)
///   - `Burn`              → `ROLE_MINTER`
///   - `ForceBurn`         → `ROLE_COMPLIANCE_DELEGATE`
///   - `ForceTransfer`     → `ROLE_COMPLIANCE_DELEGATE`
///   - `Transfer`          → `ROLE_MINTER`
///   - `OwnershipTransfer` → admin (checked via Config)
///
/// For admin-gated operations (`SetRole`, `OwnershipTransfer`), the
/// `role` account can be any valid Role PDA the admin holds — the
/// handler checks `Config.admin` directly. For role-gated operations,
/// the `role` account must match the expected role for the operation.
///
/// `seed: u64` is a caller-chosen nonce for PDA uniqueness — allows
/// the same proposer to have multiple active proposals.
#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateTimeLockProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,

    /// The proposer's role PDA. Must match the expected role for the operation type.
    /// For admin-only ops, this is still required to exist but the handler additionally checks Config.admin.
    #[account(
        seeds = [ROLE_SEED, role.role.as_ref(), proposer.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
        constraint = role.grantee == proposer.key() @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(
        init,
        payer = proposer,
        space = ANCHOR_DISCRIMINATOR_SIZE + TimeLock::INIT_SPACE,
        seeds = [seed.to_le_bytes().as_ref(), proposer.key().as_ref()],
        bump,
    )]
    pub timelock: Account<'info, TimeLock>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateTimeLockProposal>,
    _seed: u64,
    operation: TimeLockOperation,
    action_data: Vec<u8>,
) -> Result<()> {
    let role = &ctx.accounts.role;

    // Verify the proposer's role matches the operation type.
    let expected_role = match operation {
        TimeLockOperation::Pause => ROLE_PAUSER,
        TimeLockOperation::Burn | TimeLockOperation::Transfer => ROLE_MINTER,
        TimeLockOperation::ForceBurn | TimeLockOperation::ForceTransfer => {
            ROLE_COMPLIANCE_DELEGATE
        }
        // SetRole and OwnershipTransfer are admin-gated — any granted
        // role satisfies the PDA constraint; the execute handler will
        // additionally check Config.admin.
        TimeLockOperation::SetRole | TimeLockOperation::OwnershipTransfer => role.role,
    };

    require!(role.role == expected_role, MmfError::MissingRole);

    // Reject malformed proposals up front: the parameter bytes must be the
    // exact width the executor will recompute and compare against.
    require!(
        action_data.len() == TimeLock::expected_action_data_len(operation),
        MmfError::TimelockActionMismatch
    );

    ctx.accounts.timelock.set_inner(TimeLock {
        operation,
        action_data,
        proposer: ctx.accounts.proposer.key(),
        responder: None,
        executer: None,
        status: TimeLockStatus::Proposed,
        timestamp: Clock::get()?.unix_timestamp,
        bump: ctx.bumps.timelock,
    });

    msg!(
        "timelock proposal created by {} for {:?}",
        ctx.accounts.proposer.key(),
        operation
    );
    Ok(())
}
