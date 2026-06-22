use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::{
    token_2022::spl_token_2022::instruction::transfer_checked as spl_transfer_checked,
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

/// Compliance-driven forced transfer. Always timelocked: the delegate holds
/// `ROLE_COMPLIANCE_DELEGATE`, the `timelock` must be `Accepted` with
/// operation `ForceTransfer`, the delay must have elapsed, and the accepted
/// source/destination/amount must match. There is no emergency bypass - to
/// stop a holder immediately, freeze the account first, then run this through
/// the normal maker/checker flow.
///
/// On Ethereum the Diamond operator has implicit authority to move
/// tokens — no dedicated facet needed. On Solana, Token-2022 doesn't
/// grant that power to the mint authority, so we need the
/// `PermanentDelegate` extension. The Config PDA is the mint's
/// permanent delegate, so Token-2022 will authorize the move from
/// any holder ATA.
///
/// ### Re-entrancy note
/// `transfer_checked` fires the hook, which CPIs to
/// `mmf_transfer_hook`. Splitting the hook into its own program
/// makes re-entrancy impossible here.
#[event_cpi]
#[derive(Accounts)]
pub struct ForceTransfer<'info> {
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

    pub mint: InterfaceAccount<'info, Mint>,

    /// Source ATA. *Any* holder ATA is accepted — the Config PDA is the mint's permanent delegate.
    #[account(mut, token::mint = mint)]
    pub from_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = mint)]
    pub to_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,

    // --- Transfer-hook accounts --------------------------------------------
    // `transfer_checked` fires the mint's transfer hook, so the hook's
    // accounts must travel with this CPI. The hook (`mmf_transfer_hook`)
    // detects that the authority is the permanent delegate and skips rate
    // limiting, so a seizure is never throttled - but Token-2022 still
    // resolves and passes these, so they must be present.
    
    /// CHECK: the mint's transfer hook program; Token-2022 invokes it.
    pub transfer_hook_program: UncheckedAccount<'info>,
    /// CHECK: hook ExtraAccountMetaList PDA (`["extra-account-metas", mint]`).
    pub hook_extra_account_meta_list: UncheckedAccount<'info>,
    /// CHECK: hook per-mint RateLimitConfig PDA.
    pub hook_rate_config: UncheckedAccount<'info>,
    /// CHECK: hook RateLimit PDA for the permanent delegate; not read (the
    /// hook skips delegate transfers) but Token-2022 resolves the address.
    #[account(mut)]
    pub hook_rate_limit: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ForceTransfer>, amount: u64) -> Result<()> {
    require!(amount > 0, MmfError::ZeroAmount);

    let role = &ctx.accounts.role;
    let timelock = &mut ctx.accounts.timelock;

    require!(role.role == ROLE_COMPLIANCE_DELEGATE, MmfError::MissingRole);
    require!(
        timelock.operation == TimeLockOperation::ForceTransfer,
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

    // Bind execution to the accepted proposal: the source ATA, destination
    // ATA, and amount must match what was approved.
    let expected = TimeLock::encode_force_transfer(
        &ctx.accounts.from_ata.key(),
        &ctx.accounts.to_ata.key(),
        amount,
    );
    timelock.verify_action_data(&expected)?;

    timelock.status = TimeLockStatus::Executed;
    timelock.executer = Some(ctx.accounts.delegate.key());

    let bump = [ctx.accounts.config.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];

    // Build `transfer_checked` by hand so we can append the transfer hook's
    // resolved accounts in the order Token-2022 expects:
    // [rate_config, rate_limit, hook_program, extra_account_meta_list]. The
    // anchor `transfer_checked` wrapper only emits the four base accounts, so
    // it cannot carry the hook accounts through the CPI.
    let mut ix = spl_transfer_checked(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.from_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.to_ata.key(),
        &ctx.accounts.config.key(),
        &[],
        amount,
        ctx.accounts.mint.decimals,
    )?;
    ix.accounts.push(AccountMeta::new_readonly(ctx.accounts.hook_rate_config.key(), false));
    ix.accounts.push(AccountMeta::new(ctx.accounts.hook_rate_limit.key(), false));
    ix.accounts.push(AccountMeta::new_readonly(ctx.accounts.transfer_hook_program.key(), false));
    ix.accounts.push(AccountMeta::new_readonly(ctx.accounts.hook_extra_account_meta_list.key(), false));

    invoke_signed(
        &ix,
        &[
            ctx.accounts.from_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.to_ata.to_account_info(),
            ctx.accounts.config.to_account_info(),
            ctx.accounts.hook_rate_config.to_account_info(),
            ctx.accounts.hook_rate_limit.to_account_info(),
            ctx.accounts.transfer_hook_program.to_account_info(),
            ctx.accounts.hook_extra_account_meta_list.to_account_info(),
        ],
        signer_seeds,
    )?;

    msg!(
        "force-transferred {} units from {} to {}",
        amount,
        ctx.accounts.from_ata.key(),
        ctx.accounts.to_ata.key()
    );

    // Durable audit record of the seizure (see `events::AssetSeizure`).
    emit_cpi!(AssetSeizure {
        mint: ctx.accounts.mint.key(),
        from_ata: ctx.accounts.from_ata.key(),
        to_ata: Some(ctx.accounts.to_ata.key()),
        amount,
        kind: SeizureKind::Transfer,
        authority: ctx.accounts.delegate.key(),
        timelock: ctx.accounts.timelock.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
