use anchor_lang::prelude::*;

/// Per-operation timelock delays, in seconds. Stored on `Config` rather than
/// hard-coded so the issuer can re-tune them post-deploy (itself through a
/// timelocked `update_timelock_delays` proposal). The `DEFAULT_TIMELOCK_*`
/// values in `constants.rs` seed this struct at initialize time. Pause is
/// not present here - pause is immediate, not timelocked.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct TimelockDelays {
    pub set_role: i64,
    pub force_action: i64,
    pub burn: i64,
    pub ownership_transfer: i64,
    pub update_delays: i64,
}

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
    /// Monotonically incremented whenever the config is changed.
    /// Useful for off-chain reconciliation against the off-chain fund record.
    ///
    /// Pause state is deliberately *not* mirrored here - it lives in the mint's
    /// Token-2022 `Pausable` extension, the single source of truth. Read it from
    /// the mint account rather than from this program's state.
    pub version: u64,
    /// Per-operation timelock delays. Adjustable via `update_timelock_delays`
    /// (itself timelocked).
    pub delays: TimelockDelays,
    /// Bump for the config PDA, cached to avoid recomputing it on every
    /// instruction.
    pub bump: u8,
}
