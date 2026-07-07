use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{mint_to, MintTo},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED},
    error::MmfError,
    state::{Config, Role, ROLE_MINTER},
};

/// Mint fresh MMF to a holder's associated token account. Requires
/// `ROLE_MINTER`.
///
/// In production this instruction is called by the issuer subscription
/// bridge after an off-chain subscription has settled. 
/// The bridge proves the off-chain event via its own signer (a permissioned
/// pubkey that holds `ROLE_MINTER`) and the on-chain supply tracks the
/// off-chain NAV.
///
/// Because the mint authority is the Config PDA, we use `mint_to` with
/// PDA signer seeds. The holder's ATA is created idempotently.
///
/// **Default-frozen interaction.** The MMF mint is default-frozen, so a
/// freshly created ATA is frozen and `mint_to` into it would fail with
/// `AccountFrozen`. That is intentional: a holder must first be cleared on
/// the sRFC-37 Token ACL allow list and have their ATA thawed (via Token
/// ACL's permissionless thaw) before any MMF can be minted to them. In
/// practice the onboarding order is: create ATA -> add to the ABL allow list
/// -> Token ACL `thaw_permissionless` -> `mint_mmf`. The `init_if_needed`
/// here only covers the case where the (already thawed) ATA exists.
#[derive(Accounts)]
pub struct MintMmf<'info> {
    pub minter: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint @ MmfError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ROLE_SEED, ROLE_MINTER.as_ref(), minter.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
        constraint = role.role == ROLE_MINTER @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: destination holder wallet. The ATA is derived against this
    /// pubkey and the MMF mint; we don't dereference this account.
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MintMmf>, amount: u64) -> Result<()> {
    require!(amount > 0, MmfError::ZeroAmount);

    let bump = [ctx.accounts.config.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.recipient_ata.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        },
        signer_seeds,
    );
    mint_to(cpi, amount)?;

    msg!("minted {} MMF to {}", amount, ctx.accounts.recipient.key());
    Ok(())
}
