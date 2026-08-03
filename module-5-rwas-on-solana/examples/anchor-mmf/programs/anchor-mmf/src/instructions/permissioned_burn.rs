use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use spl_token_2022_interface::extension::permissioned_burn::instruction::burn_checked;

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED},
    error::MmfError,
    state::{Config, Role, ROLE_BURNER},
};

/// Role-gated self-burn through the mint's **PermissionedBurn** extension.
///
/// The MMF mint is created with PermissionedBurn (burn authority = Config
/// PDA), so the standard Token-2022 `Burn`/`BurnChecked` fail for everyone:
/// a holder cannot unilaterally destroy shares, because supply must only
/// move in lockstep with the fund's off-chain books. Every burn needs the
/// Config PDA's co-signature, and this program only produces that
/// co-signature inside its gated instructions.
///
/// This instruction is the immediate path: the signer must hold
/// `ROLE_BURNER` (the redemption bridge / an authorized redemption agent)
/// and can only burn from **their own** token account
/// (`token::authority = burner`). After an off-chain redemption settles,
/// the agent burns the shares it collected. No timelock: the blast radius
/// is bounded by the burner's own balance, matching `mint_mmf`'s risk
/// profile. Burning out of *someone else's* account is `force_burn`
/// (compliance, timelocked), and the holder-consented redemption burn is
/// `burn_mmf` (timelocked).
///
/// The extension's burn instruction requires two signatures: the burner
/// (account owner) signs the transaction, and the Config PDA (burn
/// authority) co-signs via CPI seeds - the role check above is the
/// program's condition for producing that co-signature.
///
/// Maps to the EVM `BurnableFacet`'s `BURNER_ROLE` burn of the caller's own
/// balance.
#[derive(Accounts)]
pub struct PermissionedBurn<'info> {
    pub burner: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint @ MmfError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ROLE_SEED, ROLE_BURNER.as_ref(), burner.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
        constraint = role.role == ROLE_BURNER @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The burner's own token account - `token::authority = burner` is what
    /// scopes this instruction to self-burns only.
    #[account(
        mut,
        token::mint = mint,
        token::authority = burner,
    )]
    pub burner_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<PermissionedBurn>, amount: u64) -> Result<()> {
    require!(amount > 0, MmfError::ZeroAmount);

    let bump = [ctx.accounts.config.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];

    // Burner signs the transaction (owner); Config PDA co-signs here as the
    // mint's permissioned-burn authority.
    //
    // Native `invoke_signed` rather than an anchor `CpiContext` helper:
    // anchor-spl 1.x has no wrapper for the PermissionedBurn extension yet
    // (it pins the 2.x interface crate, which predates it). A CpiContext
    // helper is only sugar over exactly this call - the instruction is still
    // built by the typed interface-crate builder, `signer_seeds` supplies the
    // Config PDA signature, and Token-2022 performs all account validation.
    // When anchor-spl ships a native wrapper, swap this for its CPI helper.
    let ix = burn_checked(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.burner_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(), // permissioned-burn authority
        &ctx.accounts.burner.key(), // token account owner
        &[],                        // no multisig signers
        amount,
        ctx.accounts.mint.decimals,
    )?;
    invoke_signed(
        &ix,
        &[
            ctx.accounts.burner_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
            ctx.accounts.burner.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    msg!(
        "permissioned burn: {} MMF from {}",
        amount,
        ctx.accounts.burner.key()
    );

    Ok(())
}
