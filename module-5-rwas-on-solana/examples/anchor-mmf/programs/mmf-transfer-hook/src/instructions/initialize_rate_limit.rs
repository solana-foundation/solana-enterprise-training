use anchor_lang::prelude::*;
use anchor_spl::{token_2022, token_interface::Mint};

use crate::{
    constants::{ANCHOR_DISCRIMINATOR_SIZE, RATE_LIMIT_SEED},
    error::HookError,
    state::RateLimit,
};

/// Create the per-(mint, owner) `RateLimit` PDA. The hook requires this
/// account to exist (it cannot create accounts mid-transfer), so this is
/// part of onboarding a holder alongside the Token ACL allow-list approval
/// + thaw. Anyone can pay to create it - the account only ever meters
/// the `owner`'s own outbound transfers, so there is no abuse vector.
#[derive(Accounts)]
pub struct InitializeRateLimit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: the holder whose outbound transfers will be metered. Only its
    /// key is used, to derive the PDA - we never dereference it.
    pub owner: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = ANCHOR_DISCRIMINATOR_SIZE + RateLimit::INIT_SPACE,
        seeds = [RATE_LIMIT_SEED, mint.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub rate_limit: Account<'info, RateLimit>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeRateLimit>) -> Result<()> {
    require!(
        ctx.accounts.mint.to_account_info().owner == &token_2022::ID,
        HookError::InvalidMint
    );

    ctx.accounts.rate_limit.set_inner(RateLimit {
        owner: ctx.accounts.owner.key(),
        mint: ctx.accounts.mint.key(),
        last_updated: Clock::get()?.unix_timestamp,
        amount_transferred: 0,
        bump: ctx.bumps.rate_limit,
    });

    msg!(
        "rate limit account created for owner {} on mint {}",
        ctx.accounts.owner.key(),
        ctx.accounts.mint.key()
    );
    Ok(())
}
