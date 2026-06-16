use std::cell::Ref;

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::{
            permanent_delegate::PermanentDelegate, transfer_hook::TransferHookAccount,
            BaseStateWithExtensions, PodStateWithExtensions,
        },
        pod::{PodAccount, PodMint},
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
    #[account(token::mint = mint)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: the transfer *authority* (the account Token-2022 passes at index
    /// 3). For a normal transfer this is the source owner; for a
    /// permanent-delegate (force) transfer it is the mint's permanent delegate.
    /// We key the per-owner `RateLimit` on it and use it to detect force
    /// transfers (see the handler).
    pub authority: UncheckedAccount<'info>,

    /// CHECK: Token-2022 ExtraAccountMetaList PDA, required by the interface.
    /// Not read by this handler.
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    // extras
    /// Per-mint policy: the cap + window the running total is measured
    /// against. Read-only here; retuned via `set_rate_limit_ix`. Keyed on the
    /// mint, so it exists for every transfer.
    #[account(
        seeds = [RATE_CONFIG_SEED, mint.key().as_ref()],
        bump = rate_config.bump,
        constraint = rate_config.mint == mint.key() @ HookError::InvalidMint,
    )]
    pub rate_config: Account<'info, RateLimitConfig>,

    /// Per-(mint, authority) running window. An `UncheckedAccount` because a
    /// permanent-delegate transfer is skipped before this is touched, and for
    /// the delegate there is no `RateLimit` PDA. The `seeds` still pin the
    /// address; the handler deserializes and validates it on the metered path.
    ///
    /// CHECK: deserialized and validated in the handler.
    #[account(
        mut,
        seeds = [RATE_LIMIT_SEED, mint.key().as_ref(), authority.key().as_ref()],
        bump,
    )]
    pub rate_limit: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // 1. Guard: we must be inside an actual Token-2022 transfer, not a
    //    direct CPI into the hook from some other program. Without this, a
    //    caller could inflate `amount_transferred` to grief an owner, or
    //    quietly roll the window forward.
    check_is_transferring(&ctx)?;

    // 2. Permanent-delegate (force) transfers are not rate limited. The
    //    index-3 authority is the mint's permanent delegate (the `mmf_admin`
    //    Config PDA) for a `force_transfer`; comparing against the mint's
    //    PermanentDelegate extension lets a compliance seizure bypass the cap
    //    entirely - it can never be throttled or blocked by a holder's limit.
    //    We return before touching `rate_limit`, which for the delegate does
    //    not exist.
    if is_permanent_delegate(&ctx)? {
        msg!("permanent-delegate transfer; skipping rate limit");
        return Ok(());
    }

    let now = Clock::get()?.unix_timestamp;
    let max_amount = ctx.accounts.rate_config.max_amount;
    let window = ctx.accounts.rate_config.window;

    // 3. Metered path. `rate_limit` is unchecked, so validate it: it must be
    //    owned by this program (i.e. an initialized `RateLimit`) and
    //    deserialize cleanly. A missing account means the owner was never
    //    onboarded with `initialize_rate_limit_ix`.
    let rate_limit_ai = ctx.accounts.rate_limit.to_account_info();
    require!(rate_limit_ai.owner == &crate::ID, HookError::RateLimitMissing);
    let mut data = rate_limit_ai.try_borrow_mut_data()?;
    let mut rate_limit = RateLimit::try_deserialize(&mut &data[..])?;

    // 4. Roll the window forward if it has fully elapsed.
    if rate_limit.is_expired(now, window) {
        rate_limit.reset(now);
        msg!("rate-limit window elapsed, counter reset");
    }

    // 5. Enforce the cap, then record this transfer.
    require!(
        !rate_limit.limit_exceeded(amount, max_amount),
        HookError::RateLimitExceeded
    );
    rate_limit.update(amount);

    rate_limit.try_serialize(&mut &mut data[..])?;

    Ok(())
}

/// True if the transfer authority (index 3) is the mint's permanent delegate.
fn is_permanent_delegate(ctx: &Context<TransferHook>) -> Result<bool> {
    let mint_ai = ctx.accounts.mint.to_account_info();
    let mint_data = mint_ai.try_borrow_data()?;
    let mint = PodStateWithExtensions::<PodMint>::unpack(&mint_data)?;
    if let Ok(ext) = mint.get_extension::<PermanentDelegate>() {
        if let Some(delegate) = Option::<Pubkey>::from(ext.delegate) {
            return Ok(delegate == ctx.accounts.authority.key());
        }
    }
    Ok(false)
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
