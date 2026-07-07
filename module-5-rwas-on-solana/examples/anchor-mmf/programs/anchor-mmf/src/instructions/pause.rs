use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenInterface};
use anchor_spl::token_2022::spl_token_2022::extension::pausable::instruction as pausable_instruction;

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED},
    error::MmfError,
    state::{Config, Role, ROLE_PAUSER},
};

/// Pause or resume the mint at the Token-2022 protocol level. **Immediate** and
/// role-gated: requires `ROLE_PAUSER`, with no timelock. Pause is the circuit
/// breaker - during an active incident you need to halt the mint in the same
/// block, not wait out a governance delay - so it is the one privileged action
/// that bypasses the maker/checker timelock. The dual-control comes from the
/// `ROLE_PAUSER` key being a multisig.
///
/// This drives the Token-2022 **Pausable** extension via a CPI signed by the
/// Config PDA (the mint's pause authority). When paused, Token-2022 itself
/// rejects every transfer, mint, and burn of the mint - including
/// permanent-delegate moves, so `force_transfer` / `force_burn` are also
/// halted. Thawing (owned by the external Token ACL) is unaffected. The pause
/// state is read from the mint's Pausable extension - this program keeps no
/// mirror of it.
#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub pauser: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint @ MmfError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ROLE_SEED, role.role.as_ref(), pauser.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
        constraint = role.grantee == pauser.key() @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    require!(ctx.accounts.role.role == ROLE_PAUSER, MmfError::MissingRole);

    // Drive the Token-2022 Pausable extension, signed by the Config PDA (the mint's pause authority).
    let bump = [ctx.accounts.config.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];
    let token_program_id = ctx.accounts.token_program.key();
    let mint_key = ctx.accounts.mint.key();

    let ix = if paused {
        pausable_instruction::pause(&token_program_id, &mint_key, &ctx.accounts.config.key(), &[])?
    } else {
        pausable_instruction::resume(&token_program_id, &mint_key, &ctx.accounts.config.key(), &[])?
    };
    invoke_signed(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    // The pause state lives in the mint's Pausable extension (the source of
    // truth); we only bump the config version as a "config changed" signal.
    ctx.accounts.config.version = ctx.accounts.config.version.saturating_add(1);
    msg!("MMF paused={}", paused);

    Ok(())
}
