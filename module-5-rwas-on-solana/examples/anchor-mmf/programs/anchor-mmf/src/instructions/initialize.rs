use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::{pausable::instruction as pausable_instruction, ExtensionType},
        state::AccountState,
        state::Mint as MintState,
    },
    token_interface::{
        default_account_state_initialize, initialize_mint2, permanent_delegate_initialize,
        transfer_hook_initialize, DefaultAccountStateInitialize, InitializeMint2,
        PermanentDelegateInitialize, TokenInterface, TransferHookInitialize,
    },
};

use crate::{
    constants::{ANCHOR_DISCRIMINATOR_SIZE, CONFIG_SEED, MMF_DECIMALS, ROLE_SEED},
    state::{Config, Role, ROLE_EMERGENCY},
};

/// One-time bootstrap: creates the singleton `Config` PDA and the MMF
/// Token-2022 mint, wiring the transfer hook extension to the sibling
/// `mmf_transfer_hook` program.
///
/// Mint authority and freeze authority are both set to the Config PDA, so
/// all future mint/burn/freeze operations must be signed via Config seeds -
/// which only this program can do.
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The deployer / first admin. In production this should be a Squads
    /// multisig co-signed by the custodians.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Global singleton state PDA.
    #[account(
        init,
        payer = admin,
        space = ANCHOR_DISCRIMINATOR_SIZE + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// The MMF Token-2022 mint, created and initialized manually in the
    /// handler. A fresh keypair, so it must sign the transaction.
    ///
    /// We create it by hand rather than with Anchor's `init` + `extensions::`
    /// constraints because the mint needs the `DefaultAccountState` extension,
    /// which anchor-spl 1.0's account macro does not support. Mint extensions
    /// must all be initialized after the account is allocated but before
    /// `initialize_mint2`, so the whole sequence has to live in one place.
    ///
    /// The mint is created with:
    ///   * 4 decimals (matches Ethereum MMF and MMF share-price precision)
    ///   * Mint authority = Config PDA
    ///   * Freeze authority = `admin` - see the note below
    ///   * TransferHook extension pointing at `mmf_transfer_hook`
    ///   * PermanentDelegate = Config PDA - lets the admin program
    ///     `force_transfer` / `force_burn` from any holder ATA for
    ///     sanctions seizures and similar compliance actions, without
    ///     requiring the holder's signature. This is the Solana
    ///     equivalent of the operator authority the MMF Diamond has
    ///     over the token supply on Ethereum.
    ///   * DefaultAccountState = Frozen - every new MMF token account is
    ///     created frozen. A holder can only transact once their account is
    ///     thawed. This moves compliance gating off the transfer hook (now
    ///     rate-limit-only) and onto Token-2022 itself.
    ///   * Pausable - a protocol-level circuit breaker. While paused,
    ///     Token-2022 itself rejects every transfer, mint, and burn of this
    ///     mint (including permanent-delegate moves). The pause authority is
    ///     the Config PDA, so only `set_paused` can flip it.
    ///
    /// Freeze authority is set to `admin` rather than the Config PDA on
    /// purpose: gating is handled by the sRFC-37 Token ACL standard
    /// (program `TACLkU6Ci…`) plus a pluggable gate program (the reference
    /// ABL allow/block list at `GATEzzqx…`), not by this program. After
    /// bootstrap the admin hands freeze authority to the Token ACL
    /// `MintConfig` PDA via its `create_config` instruction, which is what
    /// drives the permissionless thaw flow. `mmf_admin` itself never calls
    /// into Token ACL - it is purely the token issuer.
    ///
    /// CHECK: initialized as a Token-2022 mint in the handler.
    #[account(mut)]
    pub mint: Signer<'info>,

    /// Genesis role grant: the deployer receives `ROLE_EMERGENCY`. This is the
    /// one role that bootstraps the rest - `set_role`'s emergency path lets an
    /// `ROLE_EMERGENCY` holder grant every other role without a pre-existing
    /// timelock. Without it a fresh deployment could never grant its first
    /// role. It is the Solana analogue of the EVM Diamond's owner/`diamondCut`
    /// root authority and, like that, should be a multisig in production.
    #[account(
        init,
        payer = admin,
        space = ANCHOR_DISCRIMINATOR_SIZE + Role::INIT_SPACE,
        seeds = [ROLE_SEED, ROLE_EMERGENCY.as_ref(), admin.key().as_ref()],
        bump,
    )]
    pub admin_role: Account<'info, Role>,

    /// CHECK: the sibling hook program. Only its address is read, we never
    /// CPI into it from here - Token-2022 does that on every transfer.
    pub mmf_transfer_hook_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let config_key = ctx.accounts.config.key();
    let admin_key = ctx.accounts.admin.key();
    let hook_program = ctx.accounts.mmf_transfer_hook_program.key();
    let token_program_id = ctx.accounts.token_program.key();
    let token_program_ai = ctx.accounts.token_program.to_account_info();
    let mint_ai = ctx.accounts.mint.to_account_info();

    // 1. Allocate the mint account with room for all four extensions. The
    //    length must account for every extension up front - you cannot grow a
    //    mint to add an extension after `initialize_mint2`.
    let space = ExtensionType::try_calculate_account_len::<MintState>(&[
        ExtensionType::TransferHook,
        ExtensionType::PermanentDelegate,
        ExtensionType::DefaultAccountState,
        ExtensionType::Pausable,
    ])?;
    let lamports = Rent::get()?.minimum_balance(space);

    create_account(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            CreateAccount {
                from: ctx.accounts.admin.to_account_info(),
                to: mint_ai.clone(),
            },
        ),
        lamports,
        space as u64,
        &token_program_id,
    )?;

    // 2. Initialize each extension on the freshly allocated (still
    //    uninitialized) mint, before the mint itself is initialized.
    transfer_hook_initialize(
        CpiContext::new(
            token_program_id,
            TransferHookInitialize {
                token_program_id: token_program_ai.clone(),
                mint: mint_ai.clone(),
            },
        ),
        Some(config_key),
        Some(hook_program),
    )?;

    permanent_delegate_initialize(
        CpiContext::new(
            token_program_id,
            PermanentDelegateInitialize {
                token_program_id: token_program_ai.clone(),
                mint: mint_ai.clone(),
            },
        ),
        &config_key,
    )?;

    default_account_state_initialize(
        CpiContext::new(
            token_program_id,
            DefaultAccountStateInitialize {
                token_program_id: token_program_ai.clone(),
                mint: mint_ai.clone(),
            },
        ),
        &AccountState::Frozen,
    )?;

    // Pausable has no anchor-spl wrapper, so build the raw instruction. Pause
    // authority is the Config PDA. No signer is needed here: the extension is
    // initialized on the not-yet-initialized mint (the mint keypair already
    // signs the transaction for the account creation above).
    invoke(
        &pausable_instruction::initialize(&token_program_id, &mint_ai.key(), &config_key)?,
        &[token_program_ai.clone(), mint_ai.clone()],
    )?;

    // 3. Initialize the mint. Mint authority is the Config PDA so issuance
    //    (`mint_mmf` / `burn_mmf` / `force_*`) routes through this program.
    //    Freeze authority is the admin: it is handed to the Token ACL
    //    `MintConfig` PDA at bootstrap (client-side `create_config`), which
    //    is what gates the permissionless thaw flow.
    initialize_mint2(
        CpiContext::new(
            token_program_id,
            InitializeMint2 {
                mint: mint_ai.clone(),
            },
        ),
        MMF_DECIMALS,
        &config_key,
        Some(&admin_key),
    )?;

    ctx.accounts.config.set_inner(Config {
        admin: ctx.accounts.admin.key(),
        mint: ctx.accounts.mint.key(),
        paused: false,
        version: 1,
        bump: ctx.bumps.config,
    });

    // Genesis role: grant the deployer ROLE_EMERGENCY so the role system can
    // be bootstrapped (see the `admin_role` doc above).
    ctx.accounts.admin_role.set_inner(Role {
        role: ROLE_EMERGENCY,
        grantee: ctx.accounts.admin.key(),
        granted: true,
        bump: ctx.bumps.admin_role,
    });

    msg!(
        "MMF admin initialized: mint={}, admin={}, hook={}",
        ctx.accounts.config.mint,
        ctx.accounts.config.admin,
        hook_program
    );
    Ok(())
}
