/**
 * This instruction allows the user to close their vault account. 
 * It ensures that any remaining lamports in the vault are transferred back to the user.
 * By emptying the vault, the account will be automatically closed by the system program.
 * The vault state account is also closed, and the rent lamports are returned to the user.
 */

use anchor_lang::prelude::*;

use crate::{VAULT_AUTHORITY_SEED, VAULT_SEED, state::VaultState};

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump = vault_state.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        close = user,
        seeds = [VAULT_AUTHORITY_SEED, vault.key().as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Close>) -> Result<()> {
    msg!("Closing vault for {}", ctx.accounts.user.key());

    // Close the vault account by transferring all lamports back to the user and closing the account
    // We just need to ensure that the vault state account is closed by transferring the remaining lamports back to the user
    // The close attribute on the vault_state account will handle transferring the rent lamports from the account back to the user and closing the account

    // Before we close the vault account, we need to ensure that any remaining lamports in the vault are transferred back to the user.
    let vault_balance = ctx.accounts.vault.to_account_info().lamports();
    if vault_balance > 0 {
        // Create the seeds for the vault authority PDA, which will be used to sign the transfer on behalf of the vault
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
        // We need to specify the amount of lamports to transfer, which is the entire balance of the vault account
        anchor_lang::system_program::transfer(cpi_ctx, vault_balance)?;
    }

    msg!("Vault closed successfully!");
    Ok(())
}