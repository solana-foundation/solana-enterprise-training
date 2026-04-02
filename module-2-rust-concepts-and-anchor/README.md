# Module 2: Rust Concepts & Anchor

## Learning Objectives

- Explain Rust's ownership, borrowing, and reference model and why it matters for Solana development
- Work with Rust structs to represent on-chain account state
- Describe what the Anchor framework solves and how it simplifies Solana program development
- Use the Anchor CLI to create, build, test, and deploy programs
- Write Anchor account structs with appropriate constraints for validation, initialization, and PDA derivation
- Build and test a basic Solana program using Anchor

## Topics Covered

- Rust ownership and borrowing rules
- References and immutability
- Structs and data representation
- Introduction to the Anchor framework
- Anchor CLI and workspace management
- Anchor Context and `#[derive(Accounts)]`
- Account constraints: signer, mut, init, init_if_needed, has_one, address, seeds

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

Structs are one of the primary ways data is organized in Rust. They allow developers to create custom types and are the main way that on-chain account state is represented in Solana programs.

```rust
pub struct Vault {
    owner: Pubkey,
    auth_bump: u8,
    vault_bump: u8,
    score: u8,
}
```

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

The Anchor CLI provides commands for creating and managing Solana programs.

```
Usage: anchor <command>
```

| Command | Description |
|---------|-------------|
| `anchor init <program-name>` | Create a new workspace with a program |
| `anchor build` | Build all programs in the workspace |
| `anchor build <program-name>` | Build a specific program |
| `anchor test` | Run tests |
| `anchor deploy` | Deploy all programs |
| `anchor deploy <program-name>` | Deploy a specific program |

Use `anchor --help` for the full list of available commands. Appending `--help` after any command provides additional information about that command.

---

## 4. Anchor Context

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

## 5. #[derive(Accounts)]

The `#[derive(Accounts)]` macro implements a deserializer on a given struct, allowing Anchor to automatically validate all accounts before your instruction logic runs.

**Key macros:**
- `#[account]` - Marks a data structure as a Solana account
- `#[instruction]` - Provides access to instruction arguments inside account constraints

---

## 6. Account Constraints

Account constraints are the core of Anchor's validation system. They declaratively specify the requirements that each account must satisfy.

### Signer

The `signer` constraint checks that a given account has signed the transaction.

```rust
#[account(signer)]
pub authority: AccountInfo<'info>,

#[account(signer @ MyError::MyErrorCode)]
pub payer: AccountInfo<'info>,

// Or use the Signer type directly
pub payer: Signer<'info>,
```

### Mutable (mut)

The `mut` constraint checks that the account is mutable (writable).

```rust
#[account(mut)]
pub data_account: Account<'info, MyData>,

#[account(mut @ MyError::MyErrorCode)]
pub data_account_two: Account<'info, MyData>,
```

### Init

The `init` constraint creates an account via the System Program, marks it as mutable, and makes it rent-exempt. It must be used with the `payer` constraint.

```rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8)]
    pub data_account: Account<'info, MyData>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

### Init If Needed

The `init_if_needed` constraint provides the same functionality as `init`, but only initializes the account if it does not already exist. If the account already exists, the normal validation checks are still performed.

```rust
#[account(init_if_needed, payer = payer, space = 8 + 8)]
pub data_account: Account<'info, MyData>,
```

### Has One

The `has_one` constraint checks that a field in the account data matches the key of another account in the instruction.

```rust
#[account(mut, has_one = authority)]
pub data_account: Account<'info, MyData>,

pub authority: Signer<'info>,
```

### Address

The `address` constraint checks that the account's key matches a specific public key.

```rust
#[account(address = crate::ID)]
pub data_account: Account<'info, MyData>,

#[account(address = crate::ID @ MyError::MyErrorCode)]
pub other_account: AccountInfo<'info>,
```

### Seeds (PDA Validation)

The `seeds` constraint validates that an account's key matches a PDA derived from the specified seeds. It can also validate PDAs of other programs.

```rust
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct Example<'info> {
    #[account(seeds = [b"my_seed"], bump)]
    pub my_pda: AccountInfo<'info>,

    // PDA from another program
    #[account(
        seeds = [b"other_seed"],
        bump,
        seeds::program = other_program.key()
    )]
    pub pda_of_another_program: AccountInfo<'info>,
}
```

---

## Code Example

See the [examples/](examples/) folder for reference code for this module.

[PLACEHOLDER - Add example code to examples/]

## Hands-On Exercises

[PLACEHOLDER - Module 2 Exercises]

## Challenge

See the [challenge/](challenge/) folder for this module's challenge.

[PLACEHOLDER - Add challenge to challenge/]

## Additional Resources

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Anchor Book](https://book.anchor-lang.com/)
- [The Rust Programming Language (Book)](https://doc.rust-lang.org/book/)
- [Rustlings](https://github.com/rust-lang/rustlings)
- [Solana Playground](https://beta.solpg.io/)
