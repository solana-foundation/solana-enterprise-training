# Rate Limit Transfer Hook

This example demonstrates how to implement a transfer hook using the SPL Token 2022 Transfer Hook interface to enforce rate limiting on token transfers.

In this example, every token transfer is validated against a per-user rate limit. If the cumulative amount transferred within a time window exceeds the configured maximum, the transfer is rejected - providing automatic, on-chain throttling of token movements.

---

## Let's walk through the architecture:

For this program, we will have 1 main state account:

- A RateLimit account

A RateLimit account consists of:

```rust
#[account]
#[derive(InitSpace)]
pub struct RateLimit {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub max_amount: u64,
    pub last_updated: i64,
    pub amount_transferred: u64,
}
```

### In this state account, we will store:

- authority: The public key of the account that initialized (and controls) this rate limit.
- mint: The public key of the token mint this rate limit applies to.
- max_amount: The maximum cumulative amount that can be transferred within a single rate limit period.
- last_updated: The Unix timestamp of the last transfer or reset, used to determine when the window expires.
- amount_transferred: The cumulative amount transferred so far within the current rate limit period.

The rate limit resets automatically when more than 3600 seconds (1 hour) have elapsed since `last_updated`.

---

### The admin will first create a Token-2022 mint with transfer hook extensions. For that, we create the following context:

```rust
#[derive(Accounts)]
pub struct InitializeMint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = payer,
        extensions::permanent_delegate::delegate = payer,
        extensions::transfer_hook::authority = payer,
        extensions::transfer_hook::program_id = crate::ID,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}
```

Let's have a closer look at the accounts that we are passing in this context:

- payer: The account paying for the mint creation. He will be a signer of the transaction, and we mark his account as mutable as we will be deducting lamports from this account.

- mint: The Token-2022 mint account to be created. Anchor initializes it with 9 decimals, sets the payer as the mint authority and permanent delegate, and configures the transfer hook extension to point to our program.

- system_program: Program responsible for the initialization of any new account.

- token_program: The Token-2022 program that will manage this mint.

---

### The admin will then create a RateLimit account for a given mint. For that, we create the following context:

```rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = payer,
        seeds = [b"rate_limit", mint.key().as_ref(), payer.key().as_ref()],
        bump,
        space = ANCHOR_DISCRIMINATOR_SIZE + RateLimit::INIT_SPACE,
    )]
    pub rate_limit: Account<'info, RateLimit>,
    pub system_program: Program<'info, System>,
}
```

Let's have a closer look at the accounts that we are passing in this context:

- payer: Will be the person creating the rate limit account. He will be a signer of the transaction, and we mark his account as mutable as we will be deducting lamports from this account.

- mint: The token mint this rate limit will be associated with. We validate that this is a Token-2022 mint in the handler.

- rate_limit: The state account that we will initialize. We derive the RateLimit PDA from the seeds `["rate_limit", mint_pubkey, payer_pubkey]`, making each rate limit unique per mint and per user.

- system_program: Program responsible for the initialization of any new account.

### We then implement the handler for Initialize:

```rust
pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    require!(
        ctx.accounts.mint.to_account_info().owner == &token_2022::ID,
        ErrorCode::InvalidMint
    );

    ctx.accounts.rate_limit.set_inner(RateLimit {
        authority: ctx.accounts.payer.key(),
        mint: ctx.accounts.mint.key(),
        max_amount: RateLimit::MAX_AMOUNT,
        last_updated: Clock::get()?.unix_timestamp,
        amount_transferred: 0,
    });

    Ok(())
}
```

In here, we first ensure the mint is owned by the Token-2022 program. Then we set the initial data of our RateLimit account with the authority, mint, a maximum transfer amount of 1,000,000, the current timestamp, and zero amount transferred.

---

### The system will need to initialize extra account metadata for the transfer hook:

```rust
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    payer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: ExtraAccountMetaList Account, will be initialized in this instruction
    #[account(
        init,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = ExtraAccountMetaList::size_of(extra_account_metas()?.len()).unwrap(),
        payer = payer
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
```

In this context, we are passing all the accounts needed to set up the transfer hook metadata:

- payer: The address paying for the initialization. He will be a signer of the transaction, and we mark his account as mutable as we will be deducting lamports from this account.

- mint: The token mint that will have the transfer hook enabled.

- extra_account_meta_list: The account that will store the extra metadata required for the transfer hook. This account is derived from the byte representation of "extra-account-metas" and the mint's public key.

- system_program: Program responsible for the initialization of any new account.

### We then define the extra account metas for the transfer hook:

```rust
pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
    Ok(vec![
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"rate_limit".to_vec() },
                Seed::AccountKey { index: 1 },  // mint
                Seed::AccountKey { index: 3 },  // owner
            ],
            false,  // is signer
            true,   // is writable
        )?,
    ])
}
```

In here, we define the extra accounts that will be required during transfer hook execution. Unlike the whitelist example which used a hardcoded PDA via `new_with_pubkey`, we use `new_with_seeds` to let the runtime derive the rate_limit PDA dynamically at transfer time. The seeds reference the mint (account index 1) and the owner/authority (account index 3) from the standard transfer hook execute instruction accounts. This ensures each user gets their own rate limit account per mint.

---

### The transfer hook will validate every token transfer:

```rust
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(
        token::mint = mint,
        token::authority = owner,
    )]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        token::mint = mint,
    )]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source token account owner, can be SystemAccount or PDA owned by another program
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList Account
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"rate_limit", mint.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub rate_limit: Account<'info, RateLimit>,
}
```

In this context, we are passing all the accounts needed for transfer validation:

- source_token: The token account from which tokens are being transferred. We validate that it belongs to the correct mint and is owned by the owner.

- mint: The token mint being transferred.

- destination_token: The token account to which tokens are being transferred. We validate that it belongs to the correct mint.

- owner: The owner of the source token account. This can be a system account or a PDA owned by another program.

- extra_account_meta_list: The metadata account that contains information about extra accounts required for this transfer hook.

- rate_limit: The rate limit account for this specific mint and owner combination. We mark it as mutable because we will update the transferred amount on each successful transfer.

### We then implement the transfer hook handler:

```rust
pub fn handler(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    check_is_transferring(&ctx)?;

    let current_time = Clock::get()?.unix_timestamp;
    if current_time - ctx.accounts.rate_limit.last_updated > ONE_HOUR {
        ctx.accounts.rate_limit.reset();
        msg!("Rate limit has been reset due to expiration");
    }

    match ctx.accounts.rate_limit.limit_exceeded(amount) {
        true => {
            msg!("Transfer amount exceeds the rate limit");
            return Err(error!(ErrorCode::RateLimitExceeded));
        },
        false => {
            ctx.accounts.rate_limit.update(amount);
            msg!("Transfer amount is within the rate limit, proceeding with transfer");
        }
    }

    Ok(())
}
```

In this implementation, we first verify that the hook is being called during an actual transfer operation by checking the `TransferHookAccount` extension's `transferring` flag. Then we check if the rate limit period has expired (more than 1 hour since the last update) - if so, we reset the counter. Finally, we validate whether the cumulative transferred amount plus the current transfer would exceed the maximum. If it would, we reject the transfer with a `RateLimitExceeded` error; otherwise, we update the rate limit account and allow the transfer to proceed.

The `check_is_transferring` function reads the source token account's data to inspect the `TransferHookAccount` extension:

```rust
fn check_is_transferring(ctx: &Context<TransferHook>) -> Result<()> {
    let source_token_info = ctx.accounts.source_token.to_account_info();
    let account_data_ref: Ref<&mut [u8]> = source_token_info.try_borrow_data()?;
    let account = PodStateWithExtensions::<PodAccount>::unpack(*account_data_ref)?;
    let account_extension = account.get_extension::<TransferHookAccount>()?;

    if !bool::from(account_extension.transferring) {
        panic!("TransferHook: Not transferring");
    }

    Ok(())
}
```

This ensures the transfer hook can only be executed as part of a Token-2022 transfer, preventing direct invocation.

---

This rate limit transfer hook provides an automatic throttling mechanism for Token 2022 mints, ensuring that no single user can transfer more than a configured maximum amount within a rolling time window - all enforced on-chain without requiring additional user intervention.
