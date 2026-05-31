use anchor_lang::prelude::*;

/// Anchor account discriminator size.
pub const ANCHOR_DISCRIMINATOR_SIZE: usize = 8;

/// Seed prefix for the per-mint `RateLimitConfig` PDA.
/// Full seeds: `["mmf-rate-config", mint]`.
#[constant]
pub const RATE_CONFIG_SEED: &[u8] = b"mmf-rate-config";

/// Seed prefix for the per-(mint, owner) `RateLimit` PDA.
/// Full seeds: `["mmf-rate-limit", mint, owner]`.
#[constant]
pub const RATE_LIMIT_SEED: &[u8] = b"mmf-rate-limit";

/// Default rolling window length in seconds (1 hour). The admin can change
/// this per mint via `set_rate_limit_ix`.
pub const DEFAULT_RATE_WINDOW: i64 = 60 * 60;

/// Default cap on the amount that may move out of a single owner ATA within
/// one window. Expressed in base units (MMF uses 4 decimals, so this is
/// 100.0000 MMF). Admin-adjustable per mint.
pub const DEFAULT_RATE_MAX_AMOUNT: u64 = 1_000_000;
