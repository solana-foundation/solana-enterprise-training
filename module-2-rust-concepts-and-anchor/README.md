# Module 2: Rust Concepts & Anchor

## Learning Objectives

- Understand Rust's ownership model and how it prevents memory bugs at compile time
- Explain references, borrowing, and Rust's immutable-by-default philosophy
- Define and work with Rust structs, including Anchor's `#[account]` macro and discriminators
- Set up and use the Anchor CLI for Solana development
- Describe the Anchor `Context` and `#[derive(Accounts)]` macro
- Apply Anchor account constraints (Signer, mut, init, has_one, address, seeds + bump)
- Understand Cross-Program Invocations (CPIs) and how programs compose on Solana
- Build a working Lamports Vault program with Anchor
- Write tests for Solana programs

## Topics Covered

- Ownership and Ownership Rules
- References and Borrowing
- Immutable by Default
- Structs
- Why Anchor
- Anchor CLI
- Lifetimes and `'info`
- Anchor Context
- `#[derive(Accounts)]`
- Account Constraints: Signer and mut
- Account Constraints: init and init_if_needed
- Account Constraints: has_one and address
- Account Constraints: seeds + bump
- Cross-Program Invocations (CPIs)
- Live Coding: Lamports Vault
- Challenge: Per-Transaction Withdrawal Limit

## Slides

[Rust Concepts & Anchor slides](https://docs.google.com/presentation/d/1ZioRgTA5rqf6ba1XCqXRJlbWx8hFkH_YB971IO8AJ9Y/edit?usp=sharing)

---

## 1. Rust Concepts

Rust is the primary language for writing Solana programs. Before working with the Anchor framework, it is important to understand a few foundational Rust concepts that directly affect how Solana programs are written and how on-chain data is managed.

### Ownership Rules

Ownership is Rust's system for memory management without a garbage collector. If the ownership rules are violated, the program will not compile.

**The three rules of ownership:**
1. Each value in Rust has an **owner**
2. There can only be **one owner** at a time
3. When the owner goes out of scope, the value will be **dropped**

This model ensures memory safety at compile time, eliminating entire classes of bugs that are common in other systems languages.

### References and Borrowing

References allow you to refer to a value **without taking ownership** of it. Use the ampersand (`&`) to create a reference to a value.

**Key rules:**
- References are **immutable by default**
- You cannot borrow a value as mutable more than once at the same time
- There can only be one owner at a time
- When the owner goes out of scope, the value will be dropped

### Immutability by Default

Variables in Rust are immutable by default. Every `let` binding is read-only unless explicitly declared as mutable with `mut`. This forces developers to be intentional about every piece of mutable state in their program.

```rust
// This will not compile
let my_number = 10;
my_number += 1;

// This is correct
let mut my_number = 10;
my_number += 1;
```

### Structs

Structs are one of the primary ways data is organized in Rust. They let you define your own typed records and are the primary way to represent account state data in Anchor.

In Anchor, every account's state lives in a `#[account]`-annotated struct. Anchor prepends every account with an **8-byte discriminator** — a tag derived from hashing the account name. This prevents a program from accidentally reading account A as type B.

```rust
#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub balance: u64,
    pub bump: u8,
}

// space = 8 + 32 + 8 + 1
//         disc owner bal bump
```

Anchor can also calculate account space automatically using `Vault::INIT_SPACE`.

---

## 2. Introduction to Anchor

Anchor is a Rust framework for Solana programs that handles account validation, serialization, and Cross-Program Invocation (CPI) boilerplate through a declarative macro system. It also provides a suite of developer tools.

**What Anchor Provides:**
- **IDL Specification** - Interface Definition Language for program interfaces
- **TypeScript package** - Automatically generates clients from the IDL
- **CLI and workspace management** - Commands for building, testing, and deploying programs
- **AVM (Anchor Version Manager)** - Manage multiple Anchor versions across projects

### What Anchor Eliminates

Anchor removes Solana's most error-prone low-level boilerplate:

**Account Validation:**
- Automatically checks account ownership, signer authority, and mutability
- PDA derivation is enforced by constraints
- Without Anchor, every account must be validated manually against raw bytes

**Account Serialization:**
- Automatically deserializes instruction data into typed Rust structs
- Account data is serialized and deserialized via macros
- Prepends an 8-byte discriminator to prevent account type confusion attacks

**Account Lifecycle:**
- Constraints handle account creation and closure
- CPIs to other programs are handled through auto-generated builders

---

## 3. Anchor CLI

```
anchor init <name>          Scaffold a new workspace + program
anchor build                Compile programs to SBPF
anchor test                 Run tests against a local validator
anchor deploy               Deploy to the configured cluster
anchor idl init             Upload IDL to on-chain account
avm use <version>           Switch Anchor versions per project
```

Run `anchor --help` for the full list. AVM (Anchor Version Manager) lets you switch between Anchor versions easily per project.

---

## 4. Lifetimes and `'info`

Rust lifetimes tell the compiler how long a reference is valid. You will see `'info` on almost every Anchor struct — it means "these references live as long as the transaction's account info data."

```rust
pub struct Initialize<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

You do not need to deeply understand lifetimes to use Anchor. The key takeaway: `'info` ties every account reference to the same underlying data that the runtime passes into your program. Anchor handles the rest. When you see `<'info>`, read it as "borrowed from the runtime for the duration of this instruction."

---

## 5. Anchor Context

Every Anchor instruction takes a `Context<T>`, where `T` is the validated accounts struct. By the time execution reaches your business logic, all accounts have been verified and are ready to use.

**Context fields:**
- `program_id` - The currently executing program's ID
- `accounts` - Deserialized and validated accounts
- `remaining_accounts` - Extra accounts passed in that are not deserialized or validated
- `bumps` - Canonical bumps found during constraint validation

```rust
pub fn initialize(ctx: Context<Initialize>, ...) -> Result<()> {
    // All accounts in ctx.accounts are already validated
    Ok(())
}
```

---

## 6. `#[derive(Accounts)]`

The `#[derive(Accounts)]` macro implements a deserializer on a given struct, allowing Anchor to automatically validate all accounts before your instruction logic runs. Without Anchor, you would have to manipulate raw byte arrays and deserialize them manually.

**Key macros:**
- `#[account]` — A macro for a data structure representing a Solana account. Enables account constraints.
- `#[instruction]` — Allows you to access instruction arguments inside account constraints.

---

## 7. Account Constraints: Signer and mut

**`Signer<'info>`** — Validates that the account has signed the transaction. Prefer `Signer<'info>` type over a bare `#[account(signer)]` constraint.

**`#[account(mut)]`** — Marks the account as writable in this transaction. Required for anything Anchor will modify (lamports, data, owner). Forgetting `mut` on an account you write to is the most common Anchor error: "account is not mutable."

```rust
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub vault: Account<'info, Vault>,
}
```

---

## 8. Account Constraints: init and init_if_needed

**`init`** does four things in one constraint: creates the account via the System Program, marks it as mutable, allocates the specified space, and pays rent-exemption from the payer.

```rust
#[account(
    init,
    payer = payer,
    space = 8 + Vault::INIT_SPACE
)]
pub vault: Account<'info, Vault>,

#[account(mut)]
pub payer: Signer<'info>,
pub system_program: Program<'info, System>,
```

Since the payer will have SOL deducted to pay for rent-exemption, they must be a signer. And since we are initializing an account, the System Program must be included.

**`init_if_needed`** — Same as `init`, but only creates the account if it does not already exist. If it does exist, it runs the same validation checks. Requires the `init-if-needed` feature flag in `Cargo.toml`. Useful for Associated Token Accounts — if the ATA is not initialized, it will create it; otherwise it does nothing.

**Caveat:** Avoid using `init_if_needed` on your own program accounts. Anchor will allow re-initialization of any account owned by the System Program or with 0 lamports, which could reset the account to its initial value.

---

## 9. Account Constraints: has_one and address

**`has_one = field`** — Checks that a field on this account matches the key of another account in the same struct. Use case: `vault.owner == signer.key()`.

**`address = key`** — Checks that the account's pubkey matches a hardcoded value. Use case: pinning a specific admin or treasury.

```rust
// owner field must match signer
#[account(
    mut,
    has_one = owner
)]
pub vault: Account<'info, Vault>,
pub owner: Signer<'info>,

// pinned admin pubkey
#[account(address = ADMIN)]
pub admin: Signer<'info>,
```

---

## 10. Account Constraints: seeds + bump

Tells Anchor that this account is a PDA derived from the specified seeds and bump.

- **`bump = vault.bump`** — Use the canonical bump stored on the account (cheap, safe).
- **`bump` (no value)** — Anchor finds it for you — costs CUs on every call.
- **`seeds::program = other.key()`** — Validate a PDA derived under another program's ID.

```rust
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault",
                 user.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
}
```

When used with `init`, Anchor calculates the canonical bump automatically. The canonical bump is the first bump (starting from 255, decrementing) that throws the address off the ed25519 curve.

---

## 11. Cross-Program Invocations (CPIs)

A Cross-Program Invocation is when one program calls another program's instruction during execution. This is how programs compose on Solana — your program can invoke the System Program to transfer SOL, invoke the Token Program to transfer tokens, or call any other deployed program.

**How it works:** Your program builds an instruction (program ID, accounts, data) and calls `invoke` or `invoke_signed`. The runtime then executes the target program with the accounts you passed. `invoke_signed` is used when your program needs to sign on behalf of a PDA it owns.

```rust
let cpi_accounts = Transfer {
    from: ctx.accounts.user.to_account_info(),
    to: ctx.accounts.vault.to_account_info(),
};

CpiContext::new(cpi_program, cpi_accounts);
```

For PDA-signed CPIs (e.g., withdrawing from a vault PDA), use `CpiContext::new_with_signer` with the PDA seeds.

**Key rules:**
- The calling program must pass all accounts the target program needs
- PDA signing via `invoke_signed` only works if the PDA was derived from the calling program's ID
- CPI depth is limited
- Indirect re-entrancy is blocked — Program A cannot be called back by a program it invoked

---

## 12. Live Coding: Lamports Vault

Build a PDA-backed vault where each user gets their own vault, derived from their pubkey.

**Instructions:**
- **initialize** — Create a vault PDA for the user.
- **deposit** — Transfer lamports from user to vault PDA.
- **withdraw** — Transfer lamports from vault to user.
- **close** — Drain remaining lamports back to owner. Reclaim rent.

See the [examples/](examples/) folder for reference code.

---

## 13. Challenge: Per-Transaction Withdrawal Limit

Extend the vault to enforce a maximum withdrawal amount per transaction.

**Requirements:**
- Add a `max_withdraw: u64` field to the Vault state
- Set it in `initialize`
- In `withdraw`, reject any amount that exceeds `max_withdraw` with a custom error
- Write tests: a valid withdrawal, a withdrawal exactly at the limit, and a withdrawal over the limit (must fail)

See the [challenge/](challenge/) folder for this module's challenge.

## Additional Resources

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Anchor Book](https://book.anchor-lang.com/)
- [The Rust Programming Language (Book)](https://doc.rust-lang.org/book/)
- [Rustlings](https://github.com/rust-lang/rustlings)
- [Solana Playground](https://beta.solpg.io/)
