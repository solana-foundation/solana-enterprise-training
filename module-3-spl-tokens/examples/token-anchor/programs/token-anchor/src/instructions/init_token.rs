use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

#[derive(Accounts)]
pub struct InitToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        mint::decimals = 6,
        mint::authority = payer,
    )]
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn init(ctx: Context<InitToken>) -> Result<()> {
    msg!("Token initialized: {:?}", ctx.accounts.mint.key());
    msg!("Mint authority: {:?}", ctx.accounts.mint.mint_authority.unwrap());
    Ok(())
}
