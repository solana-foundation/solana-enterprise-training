use anchor_lang::prelude::*;

#[error_code]
pub enum HookError {
    #[msg("Transfer hook invoked outside of a Token-2022 transfer")]
    NotTransferring,
    #[msg("Transfer would exceed the per-window rate limit for this owner")]
    RateLimitExceeded,
    #[msg("Provided mint is not a Token-2022 mint")]
    InvalidMint,
    #[msg("Signer is not the rate-limit config authority")]
    NotRateLimitAuthority,
    #[msg("Rate-limit window must be greater than zero")]
    InvalidWindow,
}
