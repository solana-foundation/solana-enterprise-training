use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct RateLimit {
    pub authority: Pubkey,          // The account that can update the rate limit
    pub mint: Pubkey,               // The mint associated with this rate limit
    pub max_amount: u64,            // The maximum amount that can be transferred within one window
    pub window_start: i64,          // The timestamp at which the current window opened
    pub amount_transferred: u64,    // The total amount transferred within the current window
}

impl RateLimit {
    // Check if the transfer amount would exceed the rate limit.
    // Saturating add: an attacker-supplied amount near u64::MAX must not
    // wrap around and sneak under the cap.
    pub fn limit_exceeded(&self, amount: u64) -> bool {
        self.amount_transferred.saturating_add(amount) > self.max_amount
    }

    // Record a successful transfer against the current window.
    // Note: this deliberately does NOT touch `window_start`. The window is
    // fixed at the moment it opened; if every transfer refreshed the
    // timestamp, steady traffic (at least one transfer per window) would
    // keep the window alive forever and the running total would never
    // reset - permanently capping an active holder.
    pub fn update(&mut self, amount: u64) {
        self.amount_transferred = self.amount_transferred.saturating_add(amount);
    }

    // Open a fresh window at `now` with a zeroed running total.
    pub fn reset(&mut self, now: i64) {
        self.amount_transferred = 0;
        self.window_start = now;
    }

    // Check whether the current window has expired as of `now`.
    pub fn is_expired(&self, now: i64, window: i64) -> bool {
        now - self.window_start > window
    }

    pub const MAX_AMOUNT: u64 = 1_000_000; // Example max amount
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rate_limit(window_start: i64, amount_transferred: u64) -> RateLimit {
        RateLimit {
            authority: Pubkey::default(),
            mint: Pubkey::default(),
            max_amount: RateLimit::MAX_AMOUNT,
            window_start,
            amount_transferred,
        }
    }

    #[test]
    fn allows_transfer_within_limit() {
        let rl = rate_limit(0, 0);
        assert!(!rl.limit_exceeded(RateLimit::MAX_AMOUNT));
    }

    #[test]
    fn rejects_transfer_over_limit() {
        let rl = rate_limit(0, 0);
        assert!(rl.limit_exceeded(RateLimit::MAX_AMOUNT + 1));
    }

    #[test]
    fn rejects_cumulative_overage() {
        let mut rl = rate_limit(0, 0);
        rl.update(RateLimit::MAX_AMOUNT - 1);
        assert!(!rl.limit_exceeded(1));
        assert!(rl.limit_exceeded(2));
    }

    #[test]
    fn saturating_add_blocks_overflow_wraparound() {
        let mut rl = rate_limit(0, 0);
        rl.update(10);
        // Without saturating arithmetic this would wrap and pass the check.
        assert!(rl.limit_exceeded(u64::MAX));
    }

    #[test]
    fn update_does_not_extend_window() {
        let mut rl = rate_limit(1_000, 0);
        rl.update(100);
        rl.update(100);
        // The window start must stay fixed regardless of activity.
        assert_eq!(rl.window_start, 1_000);
    }

    #[test]
    fn window_expires_and_reset_clears_total() {
        let mut rl = rate_limit(1_000, RateLimit::MAX_AMOUNT);
        let window = 3_600;
        assert!(!rl.is_expired(1_000 + window, window));
        let now = 1_000 + window + 1;
        assert!(rl.is_expired(now, window));
        rl.reset(now);
        assert_eq!(rl.amount_transferred, 0);
        assert_eq!(rl.window_start, now);
        assert!(!rl.limit_exceeded(1));
    }

    #[test]
    fn steady_traffic_resets_after_fixed_window() {
        // Regression test for the sliding-window bug: a holder transferring
        // every 30 minutes must still get a fresh allowance once the fixed
        // window expires, because update() never moves window_start.
        let window = 3_600;
        let mut rl = rate_limit(0, 0);
        rl.update(600_000); // t = 0
        // t = 1800: more traffic, still inside the window
        assert!(!rl.is_expired(1_800, window));
        rl.update(400_000);
        assert!(rl.limit_exceeded(1)); // cap reached
        // t = 3601: window expired even though traffic never stopped
        assert!(rl.is_expired(3_601, window));
        rl.reset(3_601);
        assert!(!rl.limit_exceeded(RateLimit::MAX_AMOUNT));
    }
}
