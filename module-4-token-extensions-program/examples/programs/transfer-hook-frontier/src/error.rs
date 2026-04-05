use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,
    #[msg("Rate limit exceeded")]
    RateLimitExceeded,
    #[msg("Invalid mint account")]
    InvalidMint,
}
