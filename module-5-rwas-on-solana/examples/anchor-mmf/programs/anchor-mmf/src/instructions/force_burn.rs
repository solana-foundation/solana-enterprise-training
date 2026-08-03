use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use spl_token_2022_interface::extension::permissioned_burn::instruction::burn_checked;

use crate::{
    constants::{CONFIG_SEED, ROLE_SEED, TIMELOCK_FORCE_ACTION},
    error::MmfError,
    events::{AssetSeizure, SeizureKind},
    state::{
        Config, Role, TimeLock, TimeLockOperation, TimeLockStatus,
        ROLE_COMPLIANCE_DELEGATE,
    },
};

/// Compliance-driven forced burn. Always timelocked: the delegate holds
/// `ROLE_COMPLIANCE_DELEGATE`, the `timelock` must be `Accepted` with
/// operation `ForceBurn`, the delay must have elapsed, and the accepted
/// parameters must match. There is no emergency bypass - to stop a holder
/// immediately, freeze the account first (gate block-list / Token ACL), then
/// run this through the normal maker/checker flow.
///
/// The Config PDA is the mint's permanent delegate, so Token-2022 authorizes
/// the burn from any holder ATA without the owner's signature. Because the
/// mint also carries the **PermissionedBurn** extension, the burn goes
/// through the extension's burn instruction: even the permanent delegate
/// must carry the burn authority's co-signature. Both are the Config PDA
/// here, so it signs in both capacities (owner/delegate + burn authority)
/// with the same seeds.
#[event_cpi]
#[derive(Accounts)]
pub struct ForceBurn<'info> {
    pub delegate: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint @ MmfError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ROLE_SEED, role.role.as_ref(), delegate.key().as_ref()],
        bump = role.bump,
        constraint = role.granted @ MmfError::MissingRole,
    )]
    pub role: Account<'info, Role>,

    #[account(mut)]
    pub timelock: Account<'info, TimeLock>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Any holder ATA. Authority is not constrained — the Config PDA is the mint's permanent delegate.
    #[account(mut, token::mint = mint)]
    pub from_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ForceBurn>, amount: u64) -> Result<()> {
    require!(amount > 0, MmfError::ZeroAmount);

    let role = &ctx.accounts.role;
    let timelock = &mut ctx.accounts.timelock;

    require!(role.role == ROLE_COMPLIANCE_DELEGATE, MmfError::MissingRole);
    require!(
        timelock.operation == TimeLockOperation::ForceBurn,
        MmfError::TimelockMismatch
    );
    require!(
        timelock.status == TimeLockStatus::Accepted,
        MmfError::TimelockNotReady
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= timelock.timestamp + TIMELOCK_FORCE_ACTION,
        MmfError::TimelockNotReady
    );

    // Bind execution to the accepted proposal: the source ATA and amount must
    // match what was approved.
    let expected = TimeLock::encode_force_burn(&ctx.accounts.from_ata.key(), amount);
    timelock.verify_action_data(&expected)?;

    timelock.status = TimeLockStatus::Executed;
    timelock.executer = Some(ctx.accounts.delegate.key());

    let bump = [ctx.accounts.config.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];

    // PermissionedBurn: the Config PDA signs both as the permanent delegate
    // (owner/delegate slot) and as the mint's burn authority - the same
    // account fills both instruction slots.
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
        &ctx.accounts.from_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(), // permissioned-burn authority
        &ctx.accounts.config.key(), // owner/delegate slot: the permanent delegate
        &[],                        // no multisig signers
        amount,
        ctx.accounts.mint.decimals,
    )?;
    invoke_signed(
        &ix,
        &[
            ctx.accounts.from_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
            ctx.accounts.config.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    msg!(
        "force-burned {} units from {}",
        amount,
        ctx.accounts.from_ata.key()
    );

    // Durable audit record of the seizure (see `events::AssetSeizure`).
    emit_cpi!(AssetSeizure {
        mint: ctx.accounts.mint.key(),
        from_ata: ctx.accounts.from_ata.key(),
        to_ata: None,
        amount,
        kind: SeizureKind::Burn,
        authority: ctx.accounts.delegate.key(),
        timelock: ctx.accounts.timelock.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
