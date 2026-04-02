/**
 * This instruction allows a user to withdraw lamports from their vault. 
 * The user must be the owner of the vault and must specify the amount they wish to withdraw. 
 * The instruction will transfer the specified amount of lamports from the vault to the user's account.
 */

use anchor_lang::prelude::*;

use crate::{VAULT_AUTHORITY_SEED, VAULT_SEED, state::VaultState};

#[derive(Accounts)]
pub struct Withdraw<'info> {
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

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    msg!("Withdrawing {} lamports from the vault", amount);

    // Create the CPI system program transfer

    // Create the seeds for the vault authority PDA, which will be used to sign the transfer on behalf of the vault
    // The seeds consist of the vault authority seed, the vault account key, and the bump seed for the vault state account
    // We need to specify the vault account key and the bump seed for the vault state account to ensure that the correct PDA is used as the signer for the transfer
    let vault_key = ctx.accounts.vault.key();
    let vault_state_bump = [ctx.accounts.vault_state.bump];
    let vault_signer_seeds = &[&[
        VAULT_AUTHORITY_SEED,
        vault_key.as_ref(),
        &vault_state_bump,
    ][..]];

    // We need to specify the accounts involved in the transfer: the vault (sender) and the user (recipient)
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user.to_account_info(),
    };

    // Create the CPI context for the system program transfer
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.system_program.key(), cpi_accounts, vault_signer_seeds);

    // Perform the transfer of lamports from the vault to the user
    // We need to specify the amount of lamports to transfer, which is provided as an argument to the handler function
    anchor_lang::system_program::transfer(cpi_ctx, amount)?;

    msg!("Withdrawal successful!");
    Ok(())
}