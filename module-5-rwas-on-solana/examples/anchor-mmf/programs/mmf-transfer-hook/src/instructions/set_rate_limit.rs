use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::RATE_CONFIG_SEED,
    error::HookError,
    state::RateLimitConfig,
};

/// Retune the per-mint rate limit. Only the `authority` recorded in the
/// `RateLimitConfig` may call this. Takes effect for every holder on their
/// next transfer - no per-owner migration is needed because the cap is read
/// live from this account inside the hook.
#[derive(Accounts)]
pub struct SetRateLimit<'info> {
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [RATE_CONFIG_SEED, mint.key().as_ref()],
        bump = rate_config.bump,
        constraint = rate_config.authority == authority.key() @ HookError::NotRateLimitAuthority,
        constraint = rate_config.mint == mint.key() @ HookError::InvalidMint,
    )]
    pub rate_config: Account<'info, RateLimitConfig>,
}

pub fn handler(ctx: Context<SetRateLimit>, max_amount: u64, window: i64) -> Result<()> {
    require!(window > 0, HookError::InvalidWindow);

    ctx.accounts.rate_config.max_amount = max_amount;
    ctx.accounts.rate_config.window = window;

    msg!("rate limit updated: max={}, window={}s", max_amount, window);
    Ok(())
}
