use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,
    #[msg("Too early to cancel the escrow")]
    TooEarlyToCancel,
}
