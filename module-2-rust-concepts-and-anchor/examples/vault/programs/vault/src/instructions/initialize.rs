/**
 * This instruction initializes a vault account by transferring lamports from the initializer to the vault account.
 * The vault account is created as a system account, and the vault authority account is created to store the state of the vault.
 * The initializer must be a signer and must have enough lamports to cover the rent-exempt balance for the vault account.
 */

use anchor_lang::prelude::*;

use crate::{VAULT_AUTHORITY_SEED, VAULT_SEED, state::VaultState};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        init,
        payer = user,
        space = 8 + VaultState::INIT_SPACE, // 8 bytes for the account discriminator + space for the VaultState struct
        seeds = [VAULT_AUTHORITY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_authority: Account<'info, VaultState>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    msg!("Initializing vault for {}", ctx.accounts.user.key());

    // Create the CPI system program transfer
    // We need to specify the accounts involved in the transfer: the initializer (payer) and the vault (recipient)
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.user.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
    };

    // Create the CPI context for the system program transfer
    // We need to specify the system program as the program to call, and the accounts involved in the transfer
    let cpi_ctx = CpiContext::new(ctx.accounts.system_program.key(), cpi_accounts);

    // Perform the transfer of lamports from the initializer to the vault
    // We need to specify the amount of lamports to transfer, which should be enough to cover the rent-exempt balance for the vault account
    anchor_lang::system_program::transfer(cpi_ctx, Rent::free().minimum_balance(ctx.accounts.vault.data_len()))?;

    msg!("Vault initialized successfully!");
    Ok(())
}
