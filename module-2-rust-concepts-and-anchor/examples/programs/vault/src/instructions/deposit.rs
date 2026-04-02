/**
 * This instruction allows a user to deposit lamports into their vault. 
 * The user must be the owner of the vault, and the deposited lamports will be transferred from the user's account to the vault account. 
 * The instruction uses a CPI call to the system program to perform the transfer of lamports.
 */

use anchor_lang::prelude::*;

use crate::{VAULT_AUTHORITY_SEED, VAULT_SEED, state::VaultState};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump = vault_state.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, vault.key().as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    msg!("Depositing {} lamports into the vault", amount);

    // Create the CPI system program transfer
    // We need to specify the accounts involved in the transfer: the user (sender) and the vault (recipient)
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.user.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
    };

    // Create the CPI context for the system program transfer
    let cpi_ctx = CpiContext::new(ctx.accounts.system_program.key(), cpi_accounts);

    // Perform the transfer of lamports from the user to the vault
    // We need to specify the amount of lamports to transfer, which is provided as an argument to the handler function
    anchor_lang::system_program::transfer(cpi_ctx, amount)?;

    msg!("Deposit successful!");
    Ok(())
}