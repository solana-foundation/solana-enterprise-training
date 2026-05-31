//! # MMF Transfer Hook
//!
//! Token-2022 transfer hook for MMF. Invoked by the token program on *every*
//! transfer of the MMF mint. Its single job is **rate limiting**: it caps how
//! much can leave any one owner ATA within a rolling window.
//!
//!  * `RateLimitConfig` (one per mint) holds the admin-tunable `max_amount`
//!    and `window`. The issuer retunes it once and every holder picks up the
//!    new cap on their next transfer.
//!  * `RateLimit` (one per mint + owner) holds the running total and the
//!    window start. The hook resets it when the window elapses, then checks
//!    and updates it on each transfer.
//!
//! ### Separation of concerns
//!
//! Compliance gating (the allowlist), pausing, and forced moves all live in
//! the sibling `mmf_admin` program and are enforced through Token-2022's
//! default-frozen account state plus the permanent delegate - *not* here.
//! This hook is deliberately narrow and self-contained: it owns only its own
//! rate-limit state and reads nothing from `mmf_admin`. That keeps the
//! per-transfer hot path cheap and lets the issuer upgrade the rate-limit
//! logic independently of the admin program.
//!
//! ### Why a separate program?
//!
//! The admin program performs CPIs that move tokens (`mint`, `force_*`). If
//! the hook lived inside it, Token-2022 would CPI back into the admin program
//! during those calls - a re-entrant edge case that is ugly to audit.
//! Splitting the hook into its own program removes that surface entirely.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("FPX37yHKMHXsJyYUgsjSrXts5ndGsS6pADM2Eok13LeX");

#[program]
pub mod mmf_transfer_hook {
    use super::*;

    /// One-time setup of the per-mint `RateLimitConfig` (cap + window).
    pub fn initialize_rate_config_ix(ctx: Context<InitializeRateConfig>) -> Result<()> {
        initialize_rate_config::handler(ctx)
    }

    /// Retune the per-mint cap + window. Authority-gated.
    pub fn set_rate_limit_ix(
        ctx: Context<SetRateLimit>,
        max_amount: u64,
        window: i64,
    ) -> Result<()> {
        set_rate_limit::handler(ctx, max_amount, window)
    }

    /// Create the per-(mint, owner) `RateLimit` account. Part of onboarding
    /// a holder, since the hook cannot create accounts mid-transfer.
    pub fn initialize_rate_limit_ix(ctx: Context<InitializeRateLimit>) -> Result<()> {
        initialize_rate_limit::handler(ctx)
    }

    /// One-time initialization of the `ExtraAccountMetaList` PDA so the
    /// Token-2022 program knows which extra accounts to pass to our
    /// `transfer_hook_ix` on every transfer.
    pub fn initialize_extra_account_meta_list_ix(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        init_extra_account_meta::handler(ctx)
    }

    /// The transfer hook itself. Discriminator is the standard
    /// `ExecuteInstruction` slice so Token-2022 routes into it correctly.
    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook_ix(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        transfer_hook::handler(ctx, amount)
    }
}
