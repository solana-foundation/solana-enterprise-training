use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{burn, Burn},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

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
/// the burn from any holder ATA.
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

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.from_ata.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        },
        signer_seeds,
    );
    burn(cpi, amount)?;

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
