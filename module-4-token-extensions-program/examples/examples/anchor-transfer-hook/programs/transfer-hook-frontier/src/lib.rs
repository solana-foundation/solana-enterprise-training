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

declare_id!("BFD3zCe35aSdWeHHfpeVtMCUmbX584w8dJZAvcLR4WDp");

#[program]
pub mod transfer_hook_frontier {

    use super::*;

    pub fn initialize_mint(ctx: Context<InitializeMint>) -> Result<()> {
        initialize_mint::handler(ctx)
    }

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn initialize_extra_account_meta_list(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
        init_extra_account_meta::handler(ctx)
    }

    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        transfer_hook::handler(ctx, amount)
    }
}
