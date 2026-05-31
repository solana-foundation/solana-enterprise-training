use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::constants::{RATE_CONFIG_SEED, RATE_LIMIT_SEED};

/// Declares the *extra* accounts Token-2022 must pass to our hook on every
/// transfer, beyond the standard `[source, mint, destination, owner]`.
///
/// Both PDAs belong to this program, so they resolve against this program's
/// id (the default for `new_with_seeds`):
///
///  0. `RateLimitConfig` - the per-mint cap + window (read-only).
///     Seeds: `["mmf-rate-config", mint]`, where `mint` is transfer
///     account index 1.
///  1. `RateLimit` - the per-(mint, owner) running window (writable; the
///     hook updates `amount_transferred`). Seeds:
///     `["mmf-rate-limit", mint, owner]`, where `owner` is index 3.
pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
    Ok(vec![
        // 0: RateLimitConfig PDA (read-only).
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: RATE_CONFIG_SEED.to_vec(),
                },
                Seed::AccountKey { index: 1 }, // mint
            ],
            false, // not a signer
            false, // read-only
        )?,
        // 1: RateLimit PDA (writable).
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: RATE_LIMIT_SEED.to_vec(),
                },
                Seed::AccountKey { index: 1 }, // mint
                Seed::AccountKey { index: 3 }, // owner
            ],
            false, // not a signer
            true,  // writable
        )?,
    ])
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: the Token-2022 program derives this PDA when it calls the
    /// hook, so we must create it at a known address.
    #[account(
        init,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = ExtraAccountMetaList::size_of(extra_account_metas()?.len()).unwrap(),
        payer = payer,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
    let extras = extra_account_metas()?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(
        &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
        &extras,
    )
    .unwrap();
    Ok(())
}
