use anchor_lang::prelude::*;

#[error_code]
pub enum MmfError {
    #[msg("Signer is not the program admin")]
    NotAdmin,
    #[msg("Signer does not hold the required role")]
    MissingRole,
    #[msg("Provided mint does not match the mint recorded in Config")]
    MintMismatch,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Timelock operation type does not match the instruction")]
    TimelockMismatch,
    #[msg("Timelock has not been accepted or delay has not elapsed")]
    TimelockNotReady,
    #[msg("Timelock has already been executed or cancelled")]
    TimelockAlreadyFinalized,
    #[msg("Responder cannot be the same entity as the proposer")]
    TimelockSelfResponse,
    #[msg("Execution parameters do not match the accepted timelock proposal")]
    TimelockActionMismatch,
}
