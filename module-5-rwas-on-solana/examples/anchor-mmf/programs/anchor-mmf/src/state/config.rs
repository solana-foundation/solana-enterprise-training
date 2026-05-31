use anchor_lang::prelude::*;

/// Singleton global state PDA. Mirrors the `ERC-2535 Diamond` diamond storage
/// slot that holds top-level configuration.
///
/// Seeds: `[b"mmf-config"]`.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Current program admin. Can grant/revoke roles and rotate itself.
    /// In production this should be a multisig shared by the custodians.
    pub admin: Pubkey,
    /// The Token-2022 mint this program governs. All instructions validate
    /// the provided mint account matches this field, so the program is
    /// effectively bound to exactly one mint after initialization.
    pub mint: Pubkey,
    /// Global pause flag. When true, `mint`/`burn` short-circuit. It does not
    /// gate thawing (owned by the external Token ACL) and the rate-limit hook
    /// does not read it. Equivalent to the Ethereum `PauseFacet` bit.
    pub paused: bool,
    /// Monotonically incremented whenever the config is changed.
    /// Useful for off-chain reconciliation against the off-chain fund record.
    pub version: u64,
    /// Bump for the config PDA, cached to avoid recomputing it on every
    /// instruction.
    pub bump: u8,
}
