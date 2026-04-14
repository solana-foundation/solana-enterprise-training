pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;

declare_id!("8qECgGYj14f3aY1vLSN58SwCxkB9YYZBgh7xizJHiwY4");

#[program]
pub mod token_anchor {
    use super::*;

    pub fn init_token(ctx: Context<InitToken>) -> Result<()> {
        init_token::init(ctx)
    }

    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        mint_tokens::mint(ctx, amount)
    }
}
