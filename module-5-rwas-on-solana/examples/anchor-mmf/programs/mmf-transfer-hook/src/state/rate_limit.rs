use anchor_lang::prelude::*;

/// Per-mint rate-limit policy. There is one `RateLimitConfig` per MMF mint,
/// owned by this hook program. It holds the admin-tunable cap and window
/// that every per-owner `RateLimit` is measured against.
///
/// Keeping the cap here (rather than baking it into each per-owner account)
/// means the issuer can retune the limit once and have it apply to every
/// holder immediately on their next transfer.
///
/// Seeds: `["mmf-rate-config", mint]`.
#[account]
#[derive(InitSpace)]
pub struct RateLimitConfig {
    /// The Token-2022 mint this policy governs.
    pub mint: Pubkey,
    /// The key allowed to change `max_amount` / `window`. In production this
    /// should be the same multisig that holds `mmf_admin`'s `Config.admin`.
    pub authority: Pubkey,
    /// Maximum base units that may leave a single owner ATA within one
    /// window. Compared against the running `RateLimit.amount_transferred`.
    pub max_amount: u64,
    /// Rolling window length in seconds. After this much time elapses with
    /// no transfer, the owner's running total resets to zero.
    pub window: i64,
    pub bump: u8,
}

/// Per-(mint, owner) running state for the rate limiter. The hook mutates
/// this on every transfer out of the owner's ATA.
///
/// Seeds: `["mmf-rate-limit", mint, owner]`.
#[account]
#[derive(InitSpace)]
pub struct RateLimit {
    /// The owner whose outbound transfers are being metered.
    pub owner: Pubkey,
    /// The mint these transfers are denominated in.
    pub mint: Pubkey,
    /// Start of the current window. Reset whenever the window elapses.
    pub last_updated: i64,
    /// Base units transferred out so far in the current window.
    pub amount_transferred: u64,
    pub bump: u8,
}

impl RateLimit {
    /// True if adding `amount` to the running total would breach `max`.
    /// Uses saturating arithmetic so a hostile `amount` near `u64::MAX`
    /// can never wrap the sum back under the cap.
    pub fn limit_exceeded(&self, amount: u64, max: u64) -> bool {
        self.amount_transferred.saturating_add(amount) > max
    }

    /// Add `amount` to the running total (saturating, for the same reason).
    pub fn update(&mut self, amount: u64) {
        self.amount_transferred = self.amount_transferred.saturating_add(amount);
    }

    /// Begin a fresh window at `now` with a zeroed total.
    pub fn reset(&mut self, now: i64) {
        self.amount_transferred = 0;
        self.last_updated = now;
    }

    /// True if the current window has fully elapsed by `now`.
    pub fn is_expired(&self, now: i64, window: i64) -> bool {
        now - self.last_updated > window
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rl(amount_transferred: u64, last_updated: i64) -> RateLimit {
        RateLimit {
            owner: Pubkey::new_from_array([1u8; 32]),
            mint: Pubkey::new_from_array([2u8; 32]),
            last_updated,
            amount_transferred,
            bump: 0,
        }
    }

    #[test]
    fn under_cap_is_allowed() {
        let r = rl(400, 0);
        assert!(!r.limit_exceeded(500, 1000));
    }

    #[test]
    fn over_cap_is_rejected() {
        let r = rl(400, 0);
        assert!(r.limit_exceeded(601, 1000));
    }

    #[test]
    fn exact_cap_is_allowed() {
        let r = rl(400, 0);
        assert!(!r.limit_exceeded(600, 1000));
    }

    #[test]
    fn saturating_add_cannot_wrap_under_cap() {
        let r = rl(10, 0);
        // A naive `a + b` would overflow-panic or wrap; saturating_add pins
        // to u64::MAX, which is still > max, so the limit is enforced.
        assert!(r.limit_exceeded(u64::MAX, 1000));
    }

    #[test]
    fn window_expiry_detected() {
        let r = rl(900, 100);
        assert!(r.is_expired(100 + 3600 + 1, 3600));
        assert!(!r.is_expired(100 + 3600, 3600));
    }

    #[test]
    fn reset_zeroes_total_and_stamps_now() {
        let mut r = rl(900, 100);
        r.reset(5000);
        assert_eq!(r.amount_transferred, 0);
        assert_eq!(r.last_updated, 5000);
    }

    #[test]
    fn update_accumulates() {
        let mut r = rl(0, 0);
        r.update(100);
        r.update(50);
        assert_eq!(r.amount_transferred, 150);
    }
}
