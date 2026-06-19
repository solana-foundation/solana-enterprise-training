use anchor_lang::prelude::*;

/// Role assignment PDA. Existence of this account == the `grantee` holds
/// the `role`. Absence == no grant. The `granted` flag lets us soft-revoke
/// without reclaiming rent, which matches the Ethereum `AccessControlFacet`
/// semantics (a mapping entry of `false`).
///
/// Seeds: `[b"mmf-role", role, grantee]`.
#[account]
#[derive(InitSpace)]
pub struct Role {
    /// 32-byte role identifier, identical scheme to OpenZeppelin / MMF
    /// Ethereum facets. See `ROLE_*` constants below.
    pub role: [u8; 32],
    /// The pubkey that holds the role.
    pub grantee: Pubkey,
    /// If false, the role was revoked; the PDA is kept around so the
    /// grantee's key doesn't have to pay re-rent to re-acquire it.
    pub granted: bool,
    pub bump: u8,
}

/// Canonical MMF role identifiers. These are the keccak256 hashes of the
/// role name strings on Ethereum; here we use stable byte identifiers — the
/// point is that they're 32 bytes and deterministic across chains.
///
/// The exact byte values don't need to match Ethereum — off-chain services
/// maintain a mapping — but it's useful to keep the names aligned so the
/// compliance team can reason about both chains with the same vocabulary.
pub const ROLE_MINTER: [u8; 32] = *b"MMF__MINTER_ROLE________________";
pub const ROLE_PAUSER: [u8; 32] = *b"MMF__PAUSER_ROLE________________";
/// Compliance delegate — can call `force_transfer` and `force_burn`, which
/// use the mint's `PermanentDelegate` extension to move or burn tokens
/// out of any holder ATA for sanctions seizures and similar actions.
pub const ROLE_COMPLIANCE_DELEGATE: [u8; 32] = *b"MMF__COMPLIANCE_DELEGATE_ROLE___";
/// Responder — can approve or reject timelock proposals. In the
/// maker/checker model, the responder is always a different entity
/// than the proposer. Typically held by the compliance officer or a
/// dedicated approval multisig.
pub const ROLE_RESPONDER: [u8; 32] = *b"MMF__RESPONDER_ROLE_____________";
/// Emergency — the break-glass role. Holding it alone authorizes the
/// emergency (no-timelock) path of every timelockable action: in a single
/// signature it skips the delay, the maker/checker second party, and the
/// action-data binding.
///
/// It is deliberately **full root**: the emergency path checks only for
/// ROLE_EMERGENCY and does **not** additionally require the action's
/// functional role (you do not also need ROLE_PAUSER to emergency-pause,
/// or ROLE_COMPLIANCE_DELEGATE to emergency-seize). This is what lets a
/// single break-glass authority pause, seize, or burn in the same block
/// during an active incident, when waiting for a delay or a second
/// transaction would let the harm complete.
///
/// Because it is unconstrained, it must be held exclusively by a
/// custodian-co-signed multisig. Dual-control for the break-glass lives in
/// that signer (e.g. a Squads 2-of-N co-signing the one tx), not in the
/// program flow — which keeps the action atomic and immediate.
pub const ROLE_EMERGENCY: [u8; 32] = *b"MMF__EMERGENCY_ROLE_____________";
