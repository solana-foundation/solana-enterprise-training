use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::Escrow;

#[derive(Accounts)]
pub struct Take<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,
    #[account(mut)]
    pub maker: SystemAccount<'info>,
    #[account(
        mut,
        close = taker, 
        has_one = mint_a, 
        has_one = mint_b,
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint_a: InterfaceAccount<'info, Mint>,
    pub mint_b: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_a,
        associated_token::authority = taker,
    )]
    pub taker_ata_a: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = taker,
    )]
    pub taker_ata_b: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_b,
        associated_token::authority = maker,
    )]
    pub maker_ata_b: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
    )]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<Take>) -> Result<()> {
    // Transfer amount_b from taker to maker
    let cpi_accounts = anchor_spl::token_interface::TransferChecked {
        from: ctx.accounts.taker_ata_b.to_account_info(),
        mint: ctx.accounts.mint_b.to_account_info(),
        to: ctx.accounts.maker_ata_b.to_account_info(),
        authority: ctx.accounts.taker.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    anchor_spl::token_interface::transfer_checked(
        cpi_ctx,
        ctx.accounts.escrow.amount_b,
        ctx.accounts.mint_b.decimals,
    )?;

    // Transfer amount_a from vault to taker
    let cpi_accounts = anchor_spl::token_interface::TransferChecked {
        from: ctx.accounts.vault_a.to_account_info(),
        mint: ctx.accounts.mint_a.to_account_info(),
        to: ctx.accounts.taker_ata_a.to_account_info(),
        authority: ctx.accounts.escrow.to_account_info(),
    };

    let seeds = &[
        &b"escrow"[..],
        ctx.accounts.escrow.maker.as_ref(),
        &[ctx.accounts.escrow.bump]
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(), 
        cpi_accounts, 
        signer_seeds
    );
    anchor_spl::token_interface::transfer_checked(
        cpi_ctx,
        ctx.accounts.escrow.amount_a,
        ctx.accounts.mint_a.decimals,
    )?;

    close_vault(ctx)
}

pub fn close_vault(ctx: Context<Take>) -> Result<()> {
    let cpi_accounts = anchor_spl::token_interface::CloseAccount {
        account: ctx.accounts.vault_a.to_account_info(),
        destination: ctx.accounts.maker.to_account_info(),
        authority: ctx.accounts.escrow.to_account_info(),
    };

    let seeds = &[
        &b"escrow"[..],
        ctx.accounts.escrow.maker.as_ref(),
        &[ctx.accounts.escrow.bump]
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(), 
        cpi_accounts, 
        signer_seeds
    );
    anchor_spl::token_interface::close_account(cpi_ctx)
}