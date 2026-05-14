# Token Anchor

This example demonstrates how to create and mint SPL tokens using the Anchor framework on Solana.

In this example, an authority first initializes a new SPL Token mint and then mints tokens directly into a destination wallet's associated token account - showing the full lifecycle of a fungible token from creation to distribution.

---

## Let's walk through the architecture:

This program does not maintain any custom on-chain state accounts. Instead, it works directly with the standard SPL Token program's accounts:

- A **Mint** account that tracks the token supply, decimals, and mint authority.
- A **TokenAccount** (Associated Token Account) that holds the token balance for a given wallet.

Both account types are owned and managed by the SPL Token program. Anchor's `anchor-spl` crate provides the typed wrappers used throughout.

---

### The admin will first create an SPL Token mint. For that, we create the following context:

```rust
#[derive(Accounts)]
pub struct InitToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        mint::decimals = 6,
        mint::authority = payer,
    )]
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
```

Let's have a closer look at the accounts that we are passing in this context:

- payer: The account paying for the mint creation. He will be a signer of the transaction, and we mark his account as mutable as we will be deducting lamports from this account.

- mint: The SPL Token mint account to be created. Anchor initializes it with 6 decimals and sets the payer as the sole mint authority, meaning only the payer can issue new tokens.

- system_program: Program responsible for the initialization of any new account.

- token_program: The SPL Token program that will own and manage this mint.

### We then implement the handler for InitToken:

```rust
pub fn init(ctx: Context<InitToken>) -> Result<()> {
    msg!("Token initialized: {:?}", ctx.accounts.mint.key());
    msg!("Mint authority: {:?}", ctx.accounts.mint.mint_authority.unwrap());
    Ok(())
}
```

In here, Anchor handles all initialization logic through the account constraints. The handler simply logs the newly created mint's public key and its authority for observability.

---

### The mint authority will then mint tokens to a destination wallet. For that, we create the following context:

```rust
#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(mut)]
    pub mint_authority: Signer<'info>,
    pub destination: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = mint_authority,
        associated_token::mint = mint,
        associated_token::authority = destination,
    )]
    pub destination_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        mint::authority = mint_authority,
    )]
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
```

Let's have a closer look at the accounts that we are passing in this context:

- mint_authority: The account authorized to mint new tokens. He will be a signer of the transaction, and we mark his account as mutable because he funds the creation of the destination token account if it does not yet exist.

- destination: The system wallet that will receive the minted tokens. It is used as the authority for the destination token account.

- destination_token_account: The Associated Token Account that will hold the minted tokens. The `init_if_needed` constraint creates this account if it doesn't already exist, deriving it deterministically from the destination wallet and the mint.

- mint: The token mint whose supply we are increasing. We mark it as mutable because the total supply will be updated, and we validate that the signer is its mint authority.

- system_program: Program responsible for the initialization of any new account.

- token_program: The SPL Token program that will execute the mint-to CPI.

- associated_token_program: The Associated Token program used to derive and initialize the destination's token account.

### We then implement the handler for MintTokens:

```rust
pub fn mint(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    let cpi_account = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.destination_token_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_account);
    mint_to(cpi_ctx, amount)?;

    msg!("Minted {} tokens to: {:?}", amount, ctx.accounts.destination.key());

    Ok(())
}
```

In here, we build a `MintTo` CPI context that references the mint, the destination token account, and the mint authority. We then call `mint_to` via CPI, which increases both the destination's token balance and the mint's total supply by the requested `amount`. The handler logs the destination wallet and amount for observability.

---

This token-anchor example provides a minimal but complete reference for creating and distributing SPL tokens with Anchor, covering mint initialization and token issuance through a clean two-instruction program.
