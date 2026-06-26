use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::{
    token_2022::spl_token_2022::extension::interest_bearing_mint::instruction as ibm_instruction,
    token_interface::{Mint, TokenInterface},
};

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED},
    error::MmfError,
    events::NavRateUpdated,
    state::{Config, Role, ROLE_RATE_AUTHORITY},
};

/// Write the InterestBearingMint extension's signed basis-point rate.
///
/// The rate is a signed `i16` in basis points (annualized). Token-2022 uses
/// it in `amount_to_ui_amount` so the share price accrues without changing
/// balances - this is the daily NAV mechanism for the fund and is what
/// BUIDL / FOBXX use.
///
/// Negative rates are allowed and represent a loss to the fund - useful for
/// end-of-life wind-down or unrealized impairment. Off-chain reconciliation
/// should bound the rate range; on-chain we trust the rate authority within
/// `i16::MIN..=i16::MAX`.
///
/// Not timelocked: daily NAV is operational, not privileged. The seizure
/// path (`force_*`) is what needs maker/checker; rate updates are a different
/// trust assumption (the rate authority is the fund administrator).
#[event_cpi]
#[derive(Accounts)]
pub struct UpdateNavRate<'info> {
    pub rate_authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint @ MmfError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ROLE_SEED, ROLE_RATE_AUTHORITY.as_ref(), rate_authority.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
        constraint = role.role == ROLE_RATE_AUTHORITY @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<UpdateNavRate>, new_rate_bps: i16) -> Result<()> {
    let token_program_id = ctx.accounts.token_program.key();
    let mint_key = ctx.accounts.mint.key();
    let config_key = ctx.accounts.config.key();
    let bump = [ctx.accounts.config.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];

    invoke_signed(
        &ibm_instruction::update_rate(
            &token_program_id,
            &mint_key,
            &config_key,
            &[],
            new_rate_bps,
        )?,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    emit_cpi!(NavRateUpdated {
        mint: mint_key,
        new_rate_bps,
        authority: ctx.accounts.rate_authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("MMF NAV rate set to {} bps", new_rate_bps);
    Ok(())
}
