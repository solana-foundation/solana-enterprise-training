use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{Escrow, error::ErrorCode};

#[derive(Accounts)]
pub struct Cancel<'info> {
    pub maker: Signer<'info>,
    #[account(
        mut,
        close = maker,
        seeds = [b"escrow", maker.key().as_ref(), &escrow.seed.to_le_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint_a: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = maker,
    )]
    pub maker_ata_a: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = escrow.mint_a,
        associated_token::authority = escrow,
    )]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Cancel>) -> Result<()> {
    require!(Clock::get()?.unix_timestamp - ctx.accounts.escrow.created_at >= 300, ErrorCode::TooEarlyToCancel);
    let cpi_accounts = anchor_spl::token_interface::TransferChecked {
        from: ctx.accounts.vault_a.to_account_info(),
        mint: ctx.accounts.mint_a.to_account_info(),
        to: ctx.accounts.maker_ata_a.to_account_info(),
        authority: ctx.accounts.escrow.to_account_info(),
    };
    let seeds = &[
        &b"escrow"[..],
        ctx.accounts.escrow.maker.as_ref(),
        &ctx.accounts.escrow.seed.to_le_bytes(),
        &[ctx.accounts.escrow.bump],
    ];
    let signer = &[&seeds[..]];
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer);
    anchor_spl::token_interface::transfer_checked(cpi_ctx, ctx.accounts.escrow.amount_a, ctx.accounts.mint_a.decimals)?;

    close_vault(ctx)
}

pub fn close_vault(ctx: Context<Cancel>) -> Result<()> {
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