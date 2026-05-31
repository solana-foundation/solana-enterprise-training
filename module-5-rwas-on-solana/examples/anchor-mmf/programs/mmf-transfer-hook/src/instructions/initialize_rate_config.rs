use anchor_lang::prelude::*;
use anchor_spl::{token_2022, token_interface::Mint};

use crate::{
    constants::{ANCHOR_DISCRIMINATOR_SIZE, DEFAULT_RATE_MAX_AMOUNT, DEFAULT_RATE_WINDOW, RATE_CONFIG_SEED},
    error::HookError,
    state::RateLimitConfig,
};

/// One-time setup of the per-mint `RateLimitConfig`. Run once per MMF mint,
/// typically right after the mint is created. The `authority` recorded here
/// is the only key that can later retune the cap or window.
#[derive(Accounts)]
pub struct InitializeRateConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = ANCHOR_DISCRIMINATOR_SIZE + RateLimitConfig::INIT_SPACE,
        seeds = [RATE_CONFIG_SEED, mint.key().as_ref()],
        bump,
    )]
    pub rate_config: Account<'info, RateLimitConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeRateConfig>) -> Result<()> {
    require!(
        ctx.accounts.mint.to_account_info().owner == &token_2022::ID,
        HookError::InvalidMint
    );

    ctx.accounts.rate_config.set_inner(RateLimitConfig {
        mint: ctx.accounts.mint.key(),
        authority: ctx.accounts.authority.key(),
        max_amount: DEFAULT_RATE_MAX_AMOUNT,
        window: DEFAULT_RATE_WINDOW,
        bump: ctx.bumps.rate_config,
    });

    msg!(
        "rate config initialized for mint {} (max={}, window={}s)",
        ctx.accounts.mint.key(),
        DEFAULT_RATE_MAX_AMOUNT,
        DEFAULT_RATE_WINDOW
    );
    Ok(())
}
