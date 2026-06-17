//! # MMF Admin Program
//!
//! Solana-native analogue of the MMF ERC-2535 Diamond deployed on Ethereum.
//!
//! Where the Ethereum implementation uses EIP-2535 (Diamond) to give the issuer a
//! single, upgradeable contract address backed by many facets, on Solana we
//! get the equivalent agility via program upgradeability plus Anchor's
//! instruction dispatch. This program owns **all** state that backs the MMF
//! token:
//!
//! * `Config`    — program admin, mint pubkey, version. (Pause state lives in
//!                 the mint's Token-2022 Pausable extension, not here.)
//! * `Role`      — one PDA per (role, pubkey), modelling OpenZeppelin-style
//!                 role-based access control.
//! * `TimeLock`  — generic timelock proposal PDA backing the
//!                 maker/checker/executor pattern. Maps to the EVM Diamond's
//!                 `*Timelockable` facets.
//!
//! The on-chain mint is a Token-2022 mint with `TransferHook`,
//! `PermanentDelegate`, and `DefaultAccountState = Frozen` extensions. Mint
//! authority and permanent delegate are the `Config` PDA; freeze authority is
//! the admin at creation time.
//!
//! ## Compliance gating is sRFC-37 Token ACL, not this program
//!
//! The mint is default-frozen, so an account can only transact once it has
//! been thawed. Thawing is gated by the **sRFC-37 Token ACL** standard, which
//! lives in two separate, already-deployed programs that this program does
//! **not** call into:
//!
//! * Token ACL `TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP` — holds the
//!   delegated freeze authority in a `MintConfig` PDA and exposes a
//!   permissionless thaw gated by a pluggable gate program.
//! * ABL gate `GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz` — the reference
//!   allow/block list. Allowed holders can self-thaw; block-listed holders
//!   cannot (this replaces an in-program freeze/deny-list).
//!
//! At bootstrap the admin hands freeze authority to the Token ACL `MintConfig`
//! (its `create_config`), enables permissionless thaw, and points the mint at
//! the gate. All of that is client-side; `mmf_admin` stays a pure issuer.
//!
//! ## Upgradeability
//!
//! In production, the `Config.admin` and the BPF upgrade authority should
//! both point at a Squads multisig co-signed by the custodians. That
//! multisig replaces the `diamondCut` authority on Ethereum.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("3Aenr8ahixrmMdGhivPQWwo4dZQqFSucSiW2ivUFb27e");

#[program]
pub mod mmf_admin {
    use super::*;

    /*  **** Bootstrap **** */

    /// One-time bootstrap. Creates the `Config` PDA, initializes the MMF
    /// Token-2022 mint with transfer hook + permanent delegate, and seeds
    /// the program admin.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /*  **** Timelock infrastructure **** */

    /// Create a timelock proposal for any timelockable operation.
    /// The proposer must hold the role appropriate for the operation.
    /// Maps to the "prepare" phase of the EVM's timelockable facets.
    pub fn create_timelock_proposal(
        ctx: Context<CreateTimeLockProposal>,
        seed: u64,
        operation: TimeLockOperation,
        action_data: Vec<u8>,
    ) -> Result<()> {
        instructions::create_timelock_proposal::handler(ctx, seed, operation, action_data)
    }

    /// Approve a pending timelock proposal. Requires `ROLE_RESPONDER`.
    /// The responder must be a different entity than the proposer
    /// (maker/checker separation). The delay clock starts on acceptance.
    pub fn respond_timelock_proposal(
        ctx: Context<RespondToTimeLockProposal>,
    ) -> Result<()> {
        instructions::respond_timelock_proposal::handler(ctx)
    }

    /*  **** Access control (timelockable) **** */

    /// Grant or revoke a role. Only the program admin can call this.
    /// Normal path requires an accepted timelock; emergency path
    /// requires `ROLE_EMERGENCY`.
    ///
    /// Maps to `AccessControlFacetTimelockable`.
    pub fn set_role(ctx: Context<SetRole>, role: [u8; 32], granted: bool) -> Result<()> {
        instructions::set_role::handler(ctx, role, granted)
    }

    /*  **** Pause (timelockable) **** */

    /// Pause or resume the mint via its Token-2022 Pausable extension. Normal
    /// path requires `ROLE_PAUSER` + timelock; emergency path requires
    /// `ROLE_EMERGENCY`.
    ///
    /// Maps to `PausableFacetTimelockable`.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::pause::handler(ctx, paused)
    }

    /*  **** Compliance gating (sRFC-37 Token ACL) **** */
    //
    // There are no allowlist / thaw / freeze instructions here. The mint is
    // default-frozen and thawing is gated by the external Token ACL + ABL gate
    // programs (see the crate-level docs). Onboarding (create_config, enable
    // permissionless thaw, create/maintain the allow list, thaw) is performed
    // client-side by the freeze authority; sidelining a holder is done via the
    // gate's block list. `mmf_admin` never calls into Token ACL.

    /*  **** Mint **** */

    /// Mint fresh MMF to a holder's ATA. Requires `MINTER_ROLE`.
    /// Maps to `MintableFacet`.
    pub fn mint_mmf(ctx: Context<MintMmf>, amount: u64) -> Result<()> {
        instructions::mint_mmf::handler(ctx, amount)
    }

    /*  **** Burn (timelockable, three-phase) **** */

    /// Burn MMF from a holder's ATA as part of a redemption flow.
    /// Three-phase lifecycle: propose → respond → execute (this ix).
    /// Normal path requires `ROLE_MINTER` + timelock; emergency path
    /// requires `ROLE_EMERGENCY`.
    ///
    /// Maps to `BurnPreparableFacet` → `BurnRespondableFacet` →
    /// `BurnableFacet`.
    pub fn burn_mmf(ctx: Context<BurnMmf>, amount: u64) -> Result<()> {
        instructions::burn_mmf::handler(ctx, amount)
    }

    /*  **** Force actions (timelockable, PermanentDelegate) **** */

    /// Compliance-driven forced transfer from any holder ATA. Normal
    /// path requires `ROLE_COMPLIANCE_DELEGATE` + timelock; emergency
    /// path requires `ROLE_EMERGENCY`.
    ///
    /// Maps to `ManagedAccountFacet` (implicit operator authority on EVM).
    pub fn force_transfer(ctx: Context<ForceTransfer>, amount: u64) -> Result<()> {
        instructions::force_transfer::handler(ctx, amount)
    }

    /// Compliance-driven forced burn from any holder ATA. Same
    /// timelock/emergency pattern as `force_transfer`.
    ///
    /// Maps to `ManagedTokenFacetTimelockable` (implicit operator
    /// authority on EVM).
    pub fn force_burn(ctx: Context<ForceBurn>, amount: u64) -> Result<()> {
        instructions::force_burn::handler(ctx, amount)
    }
}
