use std::cell::Ref;

use anchor_lang::prelude::*;
use anchor_spl::{token_2022::spl_token_2022::{extension::{BaseStateWithExtensions, PodStateWithExtensions, transfer_hook::TransferHookAccount}, pod::PodAccount}, token_interface::{Mint, TokenAccount}};

use crate::{ONE_HOUR, RateLimit};

#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(
        token::mint = mint, 
        token::authority = owner,
    )]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        token::mint = mint,
    )]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source token account owner, can be SystemAccount or PDA owned by another program
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList Account
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()], 
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"rate_limit", mint.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub rate_limit: Account<'info, RateLimit>,
}

/// This function is called when the transfer hook is executed.
pub fn handler(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // Fail this instruction if it is not called from within a transfer hook
    check_is_transferring(&ctx)?;

    // Check if the rate limit has expired and reset it if necessary
    let current_time = Clock::get()?.unix_timestamp;
    if current_time - ctx.accounts.rate_limit.last_updated > ONE_HOUR {
        ctx.accounts.rate_limit.reset();
        msg!("Rate limit has been reset due to expiration");
    }

    // Check if the transfer amount exceeds the rate limit
    match ctx.accounts.rate_limit.limit_exceeded(amount) {
        // If the limit is exceeded, return an error to prevent the transfer from occurring
        true => {
            msg!("Transfer amount exceeds the rate limit");
            return Err(error!(crate::error::ErrorCode::RateLimitExceeded));
        },
        // If the limit is not exceeded, update the rate limit account with the new amount transferred and allow the transfer to proceed
        false => {
            ctx.accounts.rate_limit.update(amount);
            msg!("Transfer amount is within the rate limit, proceeding with transfer");
        }
    }

    Ok(())
}

/// Checks if the transfer hook is being executed during a transfer operation.
fn check_is_transferring(ctx: &Context<TransferHook>) -> Result<()> {
    let source_token_info = ctx.accounts.source_token.to_account_info();
    let account_data_ref: Ref<&mut [u8]> = source_token_info.try_borrow_data()?;
    let account = PodStateWithExtensions::<PodAccount>::unpack(*account_data_ref)?;
    let account_extension = account.get_extension::<TransferHookAccount>()?;

    if !bool::from(account_extension.transferring) {
        panic!("TransferHook: Not transferring");
    }

    Ok(())
}