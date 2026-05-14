use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct RateLimit {
    pub authority: Pubkey,          // The account that can update the rate limit
    pub mint: Pubkey,               // The mint associated with this rate limit
    pub max_amount: u64,            // The maximum amount that can be transferred within the rate limit period
    pub last_updated: i64,          // The timestamp of the last update to the rate limit
    pub amount_transferred: u64,    // The total amount transferred within the current rate limit period
}

impl RateLimit {
    // Check if the transfer amount exceeds the rate limit
    pub fn limit_exceeded(&self, amount: u64) -> bool {
        self.amount_transferred + amount > self.max_amount
    }

    // Update the rate limit account with the new amount transferred and the current timestamp
    pub fn update(&mut self, amount: u64) {
        self.amount_transferred += amount;
        self.last_updated = Clock::get().unwrap().unix_timestamp;
    }

    // Reset the rate limit account by setting the amount transferred to 0 and updating the last updated timestamp
    pub fn reset(&mut self) {
        self.amount_transferred = 0;
        self.last_updated = Clock::get().unwrap().unix_timestamp;
    }

    // Check if the rate limit has expired based on the current timestamp and a specified expiration time
    pub fn is_expired(&self, expiration_time: i64) -> bool {
        let current_time = Clock::get().unwrap().unix_timestamp;
        current_time - self.last_updated > expiration_time
    }

    pub const MAX_AMOUNT: u64 = 1_000_000; // Example max amount
}