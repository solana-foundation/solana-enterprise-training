# SOL Vault

This example demonstrates how to create a simple SOL vault using Anchor.

In this example, a user will be able to initialize a vault, deposit SOL into it, withdraw SOL from it, and close the vault to reclaim all remaining funds.

---

## Let's walk through the architecture:

A vault state account consists of:

```rust
#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub vault_bump: u8,
    pub bump: u8,
}
```

### In this state account, we will store:

- vault_bump: the bump seed for the vault account PDA, used when signing transfers on behalf of the vault

- bump: the bump seed for the vault state account PDA itself

We use the `InitSpace` derive macro to implement the space trait that will calculate the amount of space that our account will use on-chain (without taking the Anchor discriminator into consideration).

The vault itself is a simple `SystemAccount` (a PDA that holds SOL), while the `VaultState` account stores the PDA bumps needed for signing operations.

---

### The user will be able to initialize a new vault. For that, we create the following context:

```rust
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
        space = 8 + VaultState::INIT_SPACE,
        seeds = [VAULT_AUTHORITY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_authority: Account<'info, VaultState>,
    pub system_program: Program<'info, System>,
}
```

Let's have a closer look at the accounts that we are passing in this context:

- user: the person initializing the vault. They are a signer of the transaction, and we mark their account as mutable since we will be deducting lamports for rent and the initial vault deposit

- vault: a `SystemAccount` PDA derived from the seed `"vault"` and the user's public key. This is where SOL will be stored. It is not an initialized data account - it is simply a PDA that holds lamports

- vault_authority: the state account that we initialize to store the bump seeds. We derive this PDA from the seed `"authority"` and the vault's public key. The user pays for the initialization, and the space accounts for the 8-byte Anchor discriminator plus the `VaultState` struct

- system_program: required for account creation and SOL transfers

### We then implement the initialization logic:

```rust
pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.user.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.system_program.key(), cpi_accounts);

    anchor_lang::system_program::transfer(
        cpi_ctx,
        Rent::free().minimum_balance(ctx.accounts.vault.data_len()),
    )?;

    Ok(())
}
```

In here, we perform a CPI to the System Program to transfer enough lamports from the user to the vault to cover the rent-exempt minimum balance.

---

### Users will be able to deposit SOL into their vault

```rust
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
```

In this context, we pass the accounts needed to deposit SOL:

- user: the person depositing SOL. They are a signer and must be the owner of the vault (enforced by the PDA derivation using the user's key)

- vault: the vault PDA where SOL will be deposited. We validate the seeds and use the stored bump from the vault state account

- vault_state: the state account that stores the bumps. We validate it using the authority seeds and the vault's key

- system_program: required for the SOL transfer CPI

### We then implement the deposit logic:

```rust
pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.user.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.system_program.key(), cpi_accounts);

    anchor_lang::system_program::transfer(cpi_ctx, amount)?;

    Ok(())
}
```

This is a straightforward CPI to the System Program. The user signs the transaction, so we use a standard `CpiContext::new` (no PDA signing needed) to transfer the specified amount of lamports from the user to the vault.

---

### Users will be able to withdraw SOL from their vault

```rust
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
```

The accounts are the same as the deposit context. The difference is in the implementation:

### We then implement the withdraw logic:

```rust
pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault_state_bump = [ctx.accounts.vault_state.bump];
    let vault_signer_seeds = &[&[
        VAULT_AUTHORITY_SEED,
        vault_key.as_ref(),
        &vault_state_bump,
    ][..]];

    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.system_program.key(),
        cpi_accounts,
        vault_signer_seeds,
    );

    anchor_lang::system_program::transfer(cpi_ctx, amount)?;

    Ok(())
}
```

This is where things get interesting. Unlike the deposit, where the user signs the transfer directly, here we are transferring SOL **from the vault PDA**. Since a PDA has no private key, the program must sign on behalf of it.

We construct the signer seeds using the `VAULT_AUTHORITY_SEED`, the vault's public key, and the stored bump. We then use `CpiContext::new_with_signer` to create a CPI context that proves our program derived this PDA and has the authority to sign for it.

---

### Users will be able to close their vault and reclaim all funds

```rust
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
```

In this context:

- vault_state: note the `close = user` constraint. This tells Anchor to close the vault state account and return its rent lamports to the user

- vault: we mark it as mutable so we can transfer any remaining SOL out of it

### We then implement the close logic:

```rust
pub fn handler(ctx: Context<Close>) -> Result<()> {
    let vault_balance = ctx.accounts.vault.to_account_info().lamports();
    if vault_balance > 0 {
        let vault_key = ctx.accounts.vault.key();
        let vault_state_bump = [ctx.accounts.vault_state.bump];
        let vault_signer_seeds = &[&[
            VAULT_AUTHORITY_SEED,
            vault_key.as_ref(),
            &vault_state_bump,
        ][..]];

        let cpi_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            cpi_accounts,
            vault_signer_seeds,
        );

        anchor_lang::system_program::transfer(cpi_ctx, vault_balance)?;
    }

    Ok(())
}
```

In here, we first check if the vault holds any remaining SOL. If it does, we perform a PDA-signed CPI to transfer all remaining lamports back to the user (using the same signer seeds pattern from the withdraw instruction).

The `close = user` constraint on the `vault_state` account handles closing that account and returning its rent to the user. By emptying the vault of all lamports, the vault account will also be effectively closed by the runtime.

---

## Key Concepts Demonstrated

This example reinforces the following concepts from Module 2:

- **Anchor account constraints**: `init`, `mut`, `seeds`, `bump`, `close`
- **PDA derivation**: both the vault and vault state are PDAs derived from deterministic seeds
- **CPI (Cross-Program Invocation)**: all SOL transfers are done via CPI to the System Program
- **PDA signing**: the withdraw and close instructions demonstrate signing on behalf of a PDA using `CpiContext::new_with_signer`
- **Account lifecycle**: initialize, use, and close - including reclaiming rent

## Project Structure

```
vault/
├── programs/vault/src/
│   ├── lib.rs                  # Program entrypoint and instruction routing
│   ├── constants.rs            # PDA seed definitions
│   ├── error.rs                # Custom error codes
│   ├── state/
│   │   └── vault.rs            # VaultState account definition
│   └── instructions/
│       ├── initialize.rs       # Initialize vault and state
│       ├── deposit.rs          # Deposit SOL into vault
│       ├── withdraw.rs         # Withdraw SOL from vault (PDA signer)
│       └── close.rs            # Close vault and reclaim funds
├── Cargo.toml
└── Anchor.toml
```
