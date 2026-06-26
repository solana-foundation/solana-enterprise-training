//! Instruction handlers, one per file. `instructions.rs` is the module root
//! that re-exports each handler and its `Accounts` struct so `lib.rs` can
//! dispatch cleanly.

pub mod burn_mmf;
pub mod force_burn;
pub mod force_transfer;
pub mod initialize;
pub mod mint_mmf;
pub mod pause;
pub mod update_nav_rate;
pub mod update_timelock_delays;

pub mod set_role;
pub mod cancel_timelock_proposal;
pub mod create_timelock_proposal;
pub mod respond_timelock_proposal;

pub use burn_mmf::*;
pub use force_burn::*;
pub use force_transfer::*;
pub use initialize::*;
pub use mint_mmf::*;
pub use pause::*;
pub use update_nav_rate::*;
pub use update_timelock_delays::*;
pub use set_role::*;
pub use cancel_timelock_proposal::*;
pub use create_timelock_proposal::*;
pub use respond_timelock_proposal::*;
