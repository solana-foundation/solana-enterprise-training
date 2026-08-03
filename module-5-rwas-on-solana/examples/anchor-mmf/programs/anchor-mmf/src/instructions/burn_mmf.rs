use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use spl_token_2022_interface::extension::permissioned_burn::instruction::burn_checked;

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED, TIMELOCK_BURN},
    error::MmfError,
    state::{
        Config, Role, TimeLock, TimeLockOperation, TimeLockStatus,
        ROLE_MINTER,
    },
};

/// Burn MMF from a holder's token account as part of a redemption flow.
///
/// Maps to the EVM's three-phase burn pattern:
///   `BurnPreparableFacet` → `BurnRespondableFacet` → `BurnableFacet`
///
/// On Solana, phases 1 and 2 are handled by the generic timelock
/// instructions (`create_timelock_proposal` with `Burn` operation,
/// then `respond_timelock_proposal`).
///
/// This instruction is phase 3: it validates the timelock, checks the delay,
/// and executes the burn. Requires `ROLE_MINTER` and an accepted timelock with
/// the `TIMELOCK_BURN` delay elapsed, and the holder must also sign to
/// authorize the redemption. There is no emergency bypass.
///
/// The mint carries the **PermissionedBurn** extension (burn authority =
/// Config PDA), so the burn is executed through the extension's own burn
/// instruction with two signatures: the holder (account owner, signs the
/// transaction) and the Config PDA (co-signs via CPI seeds once the
/// timelock checks pass). The holder alone could not perform this burn -
/// standard `Burn`/`BurnChecked` fail on this mint.
#[derive(Accounts)]
pub struct BurnMmf<'info> {
    pub minter: Signer<'info>,

    /// Holder must sign to authorize the burn in the happy path.
    pub holder: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint @ MmfError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ROLE_SEED, role.role.as_ref(), minter.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub timelock: Account<'info, TimeLock>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = holder,
    )]
    pub holder_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<BurnMmf>, amount: u64) -> Result<()> {
    require!(amount > 0, MmfError::ZeroAmount);

    let role = &ctx.accounts.role;
    let timelock = &mut ctx.accounts.timelock;

    require!(role.role == ROLE_MINTER, MmfError::MissingRole);
    require!(
        timelock.operation == TimeLockOperation::Burn,
        MmfError::TimelockMismatch
    );
    require!(
        timelock.status == TimeLockStatus::Accepted,
        MmfError::TimelockNotReady
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= timelock.timestamp + TIMELOCK_BURN,
        MmfError::TimelockNotReady
    );

    // Bind execution to the accepted proposal: the holder ATA and amount must
    // match what was approved.
    let expected = TimeLock::encode_burn(&ctx.accounts.holder_ata.key(), amount);
    timelock.verify_action_data(&expected)?;

    timelock.status = TimeLockStatus::Executed;
    timelock.executer = Some(ctx.accounts.minter.key());

    // PermissionedBurn: holder signs the transaction (owner), Config PDA
    // co-signs here as the mint's burn authority.
    //
    // Native `invoke_signed` rather than an anchor `CpiContext` helper:
    // anchor-spl 1.x has no wrapper for the PermissionedBurn extension yet
    // (it pins the 2.x interface crate, which predates it). A CpiContext
    // helper is only sugar over exactly this call - the instruction is still
    // built by the typed interface-crate builder, `signer_seeds` supplies the
    // Config PDA signature, and Token-2022 performs all account validation.
    // When anchor-spl ships a native wrapper, swap this for its CPI helper.
    let bump = [ctx.accounts.config.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];

    let ix = burn_checked(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.holder_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(),  // permissioned-burn authority
        &ctx.accounts.holder.key(),  // token account owner
        &[],                         // no multisig signers
        amount,
        ctx.accounts.mint.decimals,
    )?;
    invoke_signed(
        &ix,
        &[
            ctx.accounts.holder_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
            ctx.accounts.holder.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    msg!("burned {} MMF from {}", amount, ctx.accounts.holder.key());
    
    Ok(())
}
