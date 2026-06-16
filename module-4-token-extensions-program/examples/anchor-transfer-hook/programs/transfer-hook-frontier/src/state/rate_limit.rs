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
