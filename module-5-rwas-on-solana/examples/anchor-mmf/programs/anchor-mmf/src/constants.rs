use anchor_lang::prelude::*;

/// MMF uses 4 decimals on Ethereum
#[constant]
pub const MMF_DECIMALS: u8 = 4;

/// Seed for the singleton `Config` PDA. There is exactly one per program.
#[constant]
pub const CONFIG_SEED: &[u8] = b"mmf-config";

/// Seed prefix for `Role` PDAs. Full seeds: `["mmf-role", role_id, grantee]`.
#[constant]
pub const ROLE_SEED: &[u8] = b"mmf-role";

/// Anchor account discriminator size.
pub const ANCHOR_DISCRIMINATOR_SIZE: usize = 8;

// ---------------------------------------------------------------------------
// Timelock delays (seconds)
//
// Per-operation minimum delays between a timelock proposal being accepted
// and the action being executable. These mirror the on-chain timelock
// semantics of the EVM Diamond's `*Timelockable` facets.
//
// In production these should be governance-adjustable (stored in Config);
// constants are fine for the reference implementation.
// ---------------------------------------------------------------------------

/// Ownership transfer: longest delay — rotating the program admin is the
/// highest-impact operation. 7 days.
pub const TIMELOCK_OWNERSHIP_TRANSFER: i64 = 7 * 24 * 60 * 60;

/// Managed token operations (supply caps, metadata, wind-down mode).
/// 3 days.
pub const TIMELOCK_MANAGED_TOKEN: i64 = 3 * 24 * 60 * 60;

/// Role grant / revoke: adding or removing a minter, pauser, compliance
/// delegate, etc. 2 days.
pub const TIMELOCK_SET_ROLE: i64 = 2 * 24 * 60 * 60;

/// Force transfer / force burn (compliance seizure). 1 day — balances
/// urgency of sanctions enforcement against the irreversibility of
/// moving someone else's tokens.
pub const TIMELOCK_FORCE_ACTION: i64 = 1 * 24 * 60 * 60;

/// Pause / unpause: shortest delay. Pause is time-sensitive (you want to
/// stop transfers fast) but still benefits from a mandatory cool-off so
/// an operator can't flip-flop the token state in a single block.
/// 6 hours.
pub const TIMELOCK_PAUSE: i64 = 6 * 60 * 60;

/// Burn (redemption path): prepare → respond → execute. Delay starts
/// after the responder accepts. 1 day.
pub const TIMELOCK_BURN: i64 = 1 * 24 * 60 * 60;

/// Transfer (standard timelocked transfer, if used). Same as burn. 1 day.
pub const TIMELOCK_TRANSFER: i64 = 1 * 24 * 60 * 60;
