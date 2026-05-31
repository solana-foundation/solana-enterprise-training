use std::cell::Ref;

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::{
            transfer_hook::TransferHookAccount, BaseStateWithExtensions, PodStateWithExtensions,
        },
        pod::PodAccount,
    },
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{RATE_CONFIG_SEED, RATE_LIMIT_SEED},
    error::HookError,
    state::{RateLimit, RateLimitConfig},
};

/// Accounts passed in by Token-2022 on every transfer. The first five are
/// the standard transfer-hook accounts; after that come the two extras
/// declared in `extra_account_metas()`.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint, token::authority = owner)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: the source-token authority. Can be a wallet or a PDA owned by
    /// another program - we only use its key to derive the RateLimit PDA.
    pub owner: UncheckedAccount<'info>,

    /// CHECK: Token-2022 ExtraAccountMetaList PDA, required by the interface.
    /// Not read by this handler.
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    // extras
    /// Per-mint policy: the cap + window the running total is measured
    /// against. Read-only here; retuned via `set_rate_limit_ix`.
    #[account(
        seeds = [RATE_CONFIG_SEED, mint.key().as_ref()],
        bump = rate_config.bump,
        constraint = rate_config.mint == mint.key() @ HookError::InvalidMint,
    )]
    pub rate_config: Account<'info, RateLimitConfig>,

    /// Per-(mint, owner) running window. Updated on every transfer.
    #[account(
        mut,
        seeds = [RATE_LIMIT_SEED, mint.key().as_ref(), owner.key().as_ref()],
        bump = rate_limit.bump,
    )]
    pub rate_limit: Account<'info, RateLimit>,
}

pub fn handler(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // 1. Guard: we must be inside an actual Token-2022 transfer, not a
    //    direct CPI into the hook from some other program. Without this, a
    //    caller could inflate `amount_transferred` to grief an owner, or
    //    quietly roll the window forward.
    check_is_transferring(&ctx)?;

    let now = Clock::get()?.unix_timestamp;
    let max_amount = ctx.accounts.rate_config.max_amount;
    let window = ctx.accounts.rate_config.window;

    let rate_limit = &mut ctx.accounts.rate_limit;

    // 2. Roll the window forward if it has fully elapsed.
    if rate_limit.is_expired(now, window) {
        rate_limit.reset(now);
        msg!("rate-limit window elapsed, counter reset");
    }

    // 3. Enforce the cap, then record this transfer.
    require!(
        !rate_limit.limit_exceeded(amount, max_amount),
        HookError::RateLimitExceeded
    );
    rate_limit.update(amount);

    Ok(())
}

/// Must only run when Token-2022 is mid-transfer. Reading the source
/// account's `TransferHookAccount.transferring` flag is the canonical way
/// to prove that, since Token-2022 only sets it for the duration of a real
/// transfer.
fn check_is_transferring(ctx: &Context<TransferHook>) -> Result<()> {
    let src = ctx.accounts.source_token.to_account_info();
    let data_ref: Ref<&mut [u8]> = src.try_borrow_data()?;
    let account = PodStateWithExtensions::<PodAccount>::unpack(*data_ref)?;
    let ext = account.get_extension::<TransferHookAccount>()?;
    require!(bool::from(ext.transferring), HookError::NotTransferring);
    Ok(())
}
