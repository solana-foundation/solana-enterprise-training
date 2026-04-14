use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::{Mint, MintTo, Token, TokenAccount, mint_to}};

#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(mut)]
    pub mint_authority: Signer<'info>,
    pub destination: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = mint_authority,
        associated_token::mint = mint,
        associated_token::authority = destination,
    )]
    pub destination_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        mint::authority = mint_authority,
    )]
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn mint(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    let cpi_account = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.destination_token_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_account);
    mint_to(cpi_ctx, amount)?;

    msg!("Minted {} tokens to: {:?}", amount, ctx.accounts.destination.key());

    Ok(())
}