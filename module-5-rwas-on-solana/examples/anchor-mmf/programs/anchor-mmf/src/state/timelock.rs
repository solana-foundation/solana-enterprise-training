use anchor_lang::prelude::*;

use crate::error::MmfError;

/// Generic timelock proposal PDA. A single structure backing the
/// maker/checker/executor pattern for all timelockable operations.
///
/// Lifecycle:
///   1. `create_timelock_proposal`  — proposer creates with operation + data
///   2. `respond_timelock_proposal` — responder (different entity) accepts
///   3. The target action handler (e.g. `force_burn`, `set_paused`) takes
///      this PDA as a required `Account<TimeLock>` and validates status +
///      delay + action-data binding before executing. On success it marks
///      `Executed`. There is no bypass - every timelockable action goes
///      through this flow.
///
/// Seeds: `[seed.to_le_bytes(), proposer]` — the `seed: u64` is a
/// caller-chosen nonce for uniqueness.
#[account]
#[derive(InitSpace)]
pub struct TimeLock {
    pub operation: TimeLockOperation,
    /// Serialized parameters for the action. Interpretation depends on
    /// `operation`. For example, `ForceBurn` stores `[from_ata(32), amount(8)]`,
    /// `Pause` stores `[paused(1)]`, etc. Fixed size for predictable rent.
    #[max_len(128)]
    pub action_data: Vec<u8>,
    pub proposer: Pubkey,
    pub responder: Option<Pubkey>,
    pub executer: Option<Pubkey>,
    pub status: TimeLockStatus,
    /// Timestamp when the proposal was created (for Proposed) or when
    /// the responder accepted (updated on Accepted). The delay is
    /// measured from the Accepted timestamp.
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, Debug, PartialEq, Eq)]
#[derive(InitSpace)]
pub enum TimeLockOperation {
    SetRole,
    Pause,
    Transfer,
    Burn,
    ForceBurn,
    ForceTransfer,
    OwnershipTransfer,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
#[derive(InitSpace)]
pub enum TimeLockStatus {
    Proposed,
    Accepted,
    Executed,
    Cancelled,
}

/// Canonical encoding of the parameters for each timelockable operation.
///
/// The maker/checker timelock is only meaningful if an accepted proposal is
/// bound to one specific action. Without that binding, an approved
/// "force-transfer 100 from A to B" proposal could be replayed by the
/// executor as "force-transfer 100 from A to C" (or any amount), because the
/// executor takes the accounts and amount as fresh instruction inputs.
///
/// The flow that closes this gap:
///   1. The proposer encodes the exact parameters with the matching
///      `encode_*` helper and stores the bytes in `TimeLock.action_data`.
///   2. The executor recomputes the expected bytes from the real instruction
///      accounts and arguments, then calls `verify_action_data`. Any mismatch
///      aborts with `MmfError::TimelockActionMismatch`.
///
/// The byte layouts are fixed and little-endian for the integer fields, so a
/// client can build them deterministically off-chain.
impl TimeLock {
    /// `ForceTransfer`: `from_ata(32) | to_ata(32) | amount(8)` = 72 bytes.
    pub fn encode_force_transfer(from_ata: &Pubkey, to_ata: &Pubkey, amount: u64) -> Vec<u8> {
        let mut v = Vec::with_capacity(72);
        v.extend_from_slice(from_ata.as_ref());
        v.extend_from_slice(to_ata.as_ref());
        v.extend_from_slice(&amount.to_le_bytes());
        v
    }

    /// `ForceBurn`: `from_ata(32) | amount(8)` = 40 bytes.
    pub fn encode_force_burn(from_ata: &Pubkey, amount: u64) -> Vec<u8> {
        let mut v = Vec::with_capacity(40);
        v.extend_from_slice(from_ata.as_ref());
        v.extend_from_slice(&amount.to_le_bytes());
        v
    }

    /// `Burn` (redemption): `holder_ata(32) | amount(8)` = 40 bytes.
    pub fn encode_burn(holder_ata: &Pubkey, amount: u64) -> Vec<u8> {
        let mut v = Vec::with_capacity(40);
        v.extend_from_slice(holder_ata.as_ref());
        v.extend_from_slice(&amount.to_le_bytes());
        v
    }

    /// `Pause`: `paused(1)` = 1 byte.
    pub fn encode_pause(paused: bool) -> Vec<u8> {
        vec![paused as u8]
    }

    /// `SetRole`: `role(32) | grantee(32) | granted(1)` = 65 bytes.
    pub fn encode_set_role(role: &[u8; 32], grantee: &Pubkey, granted: bool) -> Vec<u8> {
        let mut v = Vec::with_capacity(65);
        v.extend_from_slice(role);
        v.extend_from_slice(grantee.as_ref());
        v.push(granted as u8);
        v
    }

    /// Expected `action_data` byte length for a given operation. Used at
    /// proposal creation as a cheap sanity gate so a malformed proposal can
    /// never be accepted or executed.
    pub fn expected_action_data_len(operation: TimeLockOperation) -> usize {
        match operation {
            TimeLockOperation::ForceTransfer | TimeLockOperation::Transfer => 72,
            TimeLockOperation::ForceBurn | TimeLockOperation::Burn => 40,
            TimeLockOperation::Pause => 1,
            TimeLockOperation::SetRole => 65,
            TimeLockOperation::OwnershipTransfer => 32,
        }
    }

    /// Require that the stored proposal parameters match `expected` exactly.
    pub fn verify_action_data(&self, expected: &[u8]) -> Result<()> {
        require!(
            self.action_data.as_slice() == expected,
            MmfError::TimelockActionMismatch
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn proposal(operation: TimeLockOperation, action_data: Vec<u8>) -> TimeLock {
        TimeLock {
            operation,
            action_data,
            proposer: key(0xAA),
            responder: Some(key(0xBB)),
            executer: None,
            status: TimeLockStatus::Accepted,
            timestamp: 0,
            bump: 0,
        }
    }

    #[test]
    fn encodings_have_fixed_widths() {
        assert_eq!(
            TimeLock::encode_force_transfer(&key(1), &key(2), 100).len(),
            72
        );
        assert_eq!(TimeLock::encode_force_burn(&key(1), 100).len(), 40);
        assert_eq!(TimeLock::encode_burn(&key(1), 100).len(), 40);
        assert_eq!(TimeLock::encode_pause(true).len(), 1);
        assert_eq!(TimeLock::encode_set_role(&[7u8; 32], &key(1), true).len(), 65);
    }

    #[test]
    fn force_transfer_binding_accepts_exact_match() {
        let from = key(1);
        let to = key(2);
        let tl = proposal(
            TimeLockOperation::ForceTransfer,
            TimeLock::encode_force_transfer(&from, &to, 100),
        );
        let expected = TimeLock::encode_force_transfer(&from, &to, 100);
        assert!(tl.verify_action_data(&expected).is_ok());
    }

    #[test]
    fn force_transfer_binding_rejects_swapped_destination() {
        let from = key(1);
        let approved_to = key(2);
        let attacker_to = key(3);
        let tl = proposal(
            TimeLockOperation::ForceTransfer,
            TimeLock::encode_force_transfer(&from, &approved_to, 100),
        );
        // Executor tries to redirect funds to a different account.
        let attempted = TimeLock::encode_force_transfer(&from, &attacker_to, 100);
        assert!(tl.verify_action_data(&attempted).is_err());
    }

    #[test]
    fn force_transfer_binding_rejects_changed_amount() {
        let from = key(1);
        let to = key(2);
        let tl = proposal(
            TimeLockOperation::ForceTransfer,
            TimeLock::encode_force_transfer(&from, &to, 100),
        );
        let attempted = TimeLock::encode_force_transfer(&from, &to, 1_000_000);
        assert!(tl.verify_action_data(&attempted).is_err());
    }

    #[test]
    fn force_burn_and_burn_bindings_round_trip() {
        let ata = key(9);
        let fb = proposal(
            TimeLockOperation::ForceBurn,
            TimeLock::encode_force_burn(&ata, 42),
        );
        assert!(fb.verify_action_data(&TimeLock::encode_force_burn(&ata, 42)).is_ok());
        assert!(fb.verify_action_data(&TimeLock::encode_force_burn(&ata, 43)).is_err());

        let b = proposal(TimeLockOperation::Burn, TimeLock::encode_burn(&ata, 42));
        assert!(b.verify_action_data(&TimeLock::encode_burn(&ata, 42)).is_ok());
        assert!(b.verify_action_data(&TimeLock::encode_burn(&key(8), 42)).is_err());
    }

    #[test]
    fn pause_and_set_role_bindings() {
        let tl = proposal(TimeLockOperation::Pause, TimeLock::encode_pause(true));
        assert!(tl.verify_action_data(&TimeLock::encode_pause(true)).is_ok());
        assert!(tl.verify_action_data(&TimeLock::encode_pause(false)).is_err());

        let role = [5u8; 32];
        let grantee = key(4);
        let sr = proposal(
            TimeLockOperation::SetRole,
            TimeLock::encode_set_role(&role, &grantee, true),
        );
        assert!(sr
            .verify_action_data(&TimeLock::encode_set_role(&role, &grantee, true))
            .is_ok());
        // Same role + grantee but flipping granted must not satisfy the proposal.
        assert!(sr
            .verify_action_data(&TimeLock::encode_set_role(&role, &grantee, false))
            .is_err());
    }
}
