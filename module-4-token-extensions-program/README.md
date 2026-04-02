# Module 4: Token Extensions Program

## Learning Objectives

- Explain the motivation behind the Token Extensions Program and how it extends the original Token Program
- Describe the TLV data model that enables backward-compatible extensions
- Identify and articulate the purpose of each mint extension and account extension
- Design permissioned token workflows using Token ACL and Gate Programs
- Compare Token ACL and Transfer Hooks and determine which approach is appropriate for a given use case

## Topics Covered

- Token Extensions Program architecture
- Mint extensions: confidential transfer, transfer fees, closing mint, interest-bearing tokens, non-transferable tokens, permanent delegate, transfer hook, metadata pointer, metadata
- Account extensions: memo required on transfer, immutable ownership, default account state, CPI guard
- Token ACL (Access Control List)
- Token ACL architecture and freeze/thaw workflows
- Token ACL vs. Transfer Hooks

## Slides

[Token Extensions slides](https://docs.google.com/presentation/d/1BgGwCRM-_oOuJEb1_guYS6IwCF_9w2odTIQujs5byvc/edit?usp=sharing)

---

## 1. Token Extensions Program

As more developers build on Solana, many find themselves needing to fork the Token Program to add functionality. While modifying and deploying a custom token program is technically simple, achieving adoption is not - wallets must trust the program, and wallets must support the program.

The **Token Extensions Program** (also known as Token-2022) solves this by adding functionality to the standard token program with minimal disruption to users, wallets, and dApps.

## 2. Mint and Account Compatibility

The Token Extensions Program maintains backward compatibility with the original Token Program:

- **Token Accounts** have the same exact representation for the first 165 bytes (the original Account size)
- **Mint Accounts** have the same representation for the first 82 bytes (the original Mint size)
- New functionality requires new fields, which are stored **after** the initial data using a TLV (Type-Length-Value) encoding scheme

The Token Extensions Program is a **superset** of the original Token Program - it adds functionality while preserving full compatibility with existing tooling.

## 3. Mint Extensions

### Confidential Transfer

Confidential Transfers hide the **amount** of tokens being transferred between accounts while keeping sender and receiver addresses publicly visible. This provides partial privacy focused solely on concealing the transaction value.

- Built on ZK proofs, specifically ElGamal encryption
- The amount is encrypted with the receiver's public key or a derived shared secret
- Only the corresponding private key (held by the receiver) can decrypt the amount
- The SPL Token 2022 SDK contains helper functions for sending confidential transfers

### Transfer Fees

The Token Extensions Program enables charging a fee on every transfer without the friction of the original Token Program's approach (which required freezing and unfreezing accounts through a third party).

With Token Extensions, fees are **withheld in the recipient account**, and a designated **withdraw withheld authority** can collect those tokens.

### Closing Mint

In the original Token Program, Token Accounts can be closed but Mint Accounts cannot. The Token Extensions Program adds the ability to close a Mint Account, provided the supply is zero (either no tokens were ever minted, or all tokens have been burned).

### Interest-Bearing Tokens

Interest-bearing tokens allow a mint to have an associated interest rate, adjustable by the mint authority.

- Interest is compounded continuously using the formula: `A = P * e^(rt)`
- The accrued interest adjusts the token amount **displayed** in wallets and explorers
- Actual token balances in accounts remain unchanged - no minting or burning takes place
- This is a **cosmetic feature** that affects display only

### Non-Transferable Tokens

Non-transferable tokens enable "soul-bound" tokens that cannot be moved to any other entity. They are ideal for achievements, credentials, or certifications that should only belong to one account.

This is similar to issuing a token and freezing the account, but it allows the user to **burn and close** the account if they choose.

### Permanent Delegate

The permanent delegate extension allows a mint creator to specify a permanent delegate with **unlimited privileges** over any account for that mint. This includes the ability to burn or transfer any amount of tokens from any holder.

**Use cases:** In some jurisdictions, a stablecoin issuer must be able to seize assets from sanctioned entities. The permanent delegate enables this capability at the protocol level.

### Transfer Hook

Transfer hooks give token creators additional control over how their token is transferred. The creator develops a program that implements the transfer hook interface and configures the token mint to use that program. The Token Extensions Program calls the hook program **after** the transfer logic executes.

**Primary use case:** Royalty enforcement on token transfers.

### Metadata Pointer and Metadata

With the potential for multiple metadata programs, a mint could have several different accounts claiming to describe it. The **metadata pointer** extension allows the creator to designate an address as the canonical metadata source.

The **metadata extension** allows the creator to include metadata directly in the mint account itself, without requiring an external metadata program. If a token has a metadata extension, the metadata pointer should reference the mint itself.

## 4. Account Extensions

### Memo Required on Transfer

Traditional banking systems require a memo to accompany all transfers. This extension enforces that all incoming transfers must include a memo instruction immediately before the transfer instruction.

- Still works with CPI, provided a CPI to log the memo is performed before the transfer
- The account owner can activate and deactivate this functionality

### CPI Guard

When enabled, the CPI Guard restricts certain operations when invoked via Cross-Program Invocation:

| Operation | Restriction |
|-----------|-------------|
| **Transfer** | Signing authority must be the account delegate |
| **Burn** | Signing authority must be the account delegate |
| **Approve** | Prohibited |
| **Close Account** | Lamports destination must be the account owner |
| **Set Close Authority** | Prohibited unless already set |
| **Set Owner** | Prohibited |

Users may enable or disable the CPI Guard extension as needed.

### Default Account State

Mint creators may want to restrict who can use their token. The Default Account State extension forces **all new token accounts to be frozen** on creation. Users must then interact with a service to unfreeze their account before they can use tokens.

This extension is the foundation of the **Token ACL** (Access Control List) program.

---

## 5. Token ACL (Access Control List)

Token ACL is a Solana program that enables **compliant, permissioned tokens** while preserving user experience. It allows enterprises to create tokens with allow/block list functionality without introducing friction for end users.

**Enterprise Use Cases:**
- Enforce KYC/AML requirements
- Block sanctioned addresses
- Restrict token transfers to approved parties

### How Token ACL Works

1. A Mint is created using the **Default Account State** extension (all new Token Accounts are frozen)
2. A user creates a Token Account - it is automatically frozen
3. The user calls a **permissionless thaw** instruction
4. The Token ACL program checks the **Gate Program**
5. The Gate Program validates the user
6. If the user is **allowed**, the account is thawed instantly
7. If the user is **blocked**, the account remains frozen

### Token ACL Architecture

Token ACL is the interaction of three programs:

**Token Extensions Program:**
- The Mint is created with the Default Account State extension to keep Token Accounts frozen on creation

**Token ACL Program:**
- A MintConfig PDA is created on the Token ACL Program for the mint
- The Mint's Freeze Authority is transferred to the MintConfig PDA
- This allows the Token ACL Program to manage freeze/thaw operations

**Gate Program:**
- An external program that implements the allow/block logic
- Issuers can build custom Gate Programs with different validation logic
- Example use cases: KYC verification, oracle-based sanctions checks, integrations with identity protocols

### Token ACL vs. Transfer Hooks

| Aspect | Token ACL | Transfer Hooks |
|--------|-----------|----------------|
| **When Logic Runs** | Only on freeze/thaw operations | On every transfer |
| **Transfer Overhead** | None - transfers proceed normally after thaw | Extra compute units and accounts on every transfer |
| **DeFi Composability** | Only during activation | Impacted on every transfer |
| **Best For** | KYC/AML, sanctions screening | Custom transfer validation, royalties |
| **Complexity** | Low - one-time thaw operation | Higher - requires additional data on every transfer |

---

## Code Example

See the [examples/](examples/) folder for reference code for this module.

[PLACEHOLDER - Add example code to examples/]

## Hands-On Exercises

[PLACEHOLDER - Module 4 Exercises]

## Challenge

See the [challenge/](challenge/) folder for this module's challenge.

[PLACEHOLDER - Add challenge to challenge/]

## Additional Resources

- [Token Extensions Documentation](https://solana.com/docs/tokens/extensions)
- [Token-2022 Program Examples](https://github.com/solana-developers/program-examples/tree/main/tokens/token-2022)
- [Solana ACL Guide](https://solana.com/developers/guides/advanced/acl)
- [Token ACL Repository](https://github.com/solana-foundation/token-acl)
