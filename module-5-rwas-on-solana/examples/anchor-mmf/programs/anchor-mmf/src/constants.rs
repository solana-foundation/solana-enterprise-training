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

// These are the *defaults* seeded into `Config.delays` at initialize. The
// live values used by handlers are read from `Config.delays`, not from these
// constants - `update_timelock_delays` (itself timelocked) re-tunes them
// post-deploy without a program upgrade. The live values are bounds-checked
// against `MIN_TIMELOCK_DELAY` and `MAX_TIMELOCK_DELAY` below.

/// Ownership transfer: longest delay - rotating the program admin is the
/// highest-impact operation. 7 days.
pub const DEFAULT_TIMELOCK_OWNERSHIP_TRANSFER: i64 = 7 * 24 * 60 * 60;

/// Role grant / revoke: adding or removing a minter, pauser, compliance
/// delegate, etc. 2 days.
pub const DEFAULT_TIMELOCK_SET_ROLE: i64 = 2 * 24 * 60 * 60;

/// Force transfer / force burn (compliance seizure). 1 day - balances
/// urgency of sanctions enforcement against the irreversibility of
/// moving someone else's tokens.
pub const DEFAULT_TIMELOCK_FORCE_ACTION: i64 = 1 * 24 * 60 * 60;

/// Burn (redemption path): prepare -> respond -> execute. Delay starts
/// after the responder accepts. 1 day.
pub const DEFAULT_TIMELOCK_BURN: i64 = 1 * 24 * 60 * 60;

/// Updating the delays themselves. Should be at least as long as the longest
/// per-operation delay so a captured admin signer can't push instant changes
/// through a too-short meta-delay. 7 days.
pub const DEFAULT_TIMELOCK_UPDATE_DELAYS: i64 = 7 * 24 * 60 * 60;

/// Lower bound on any per-operation timelock delay. Zero is allowed so a
/// devnet deployment can demonstrate the timelock flow without waiting, but
/// the value must be non-negative: a negative delay would make every
/// timelocked action ready immediately and defeat the maker/checker pattern.
pub const MIN_TIMELOCK_DELAY: i64 = 0;

/// Upper bound on any per-operation timelock delay. Bounds the timestamp
/// arithmetic against overflow and rules out the griefing case where a
/// delay is set so large that a privileged action can never execute.
/// 365 days.
pub const MAX_TIMELOCK_DELAY: i64 = 365 * 24 * 60 * 60;
