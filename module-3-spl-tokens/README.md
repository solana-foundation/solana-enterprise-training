# Module 3: SPL Tokens

## Learning Objectives

- Distinguish between the Token Program and the Token Extensions Program
- Explain the relationship between Mint Accounts, Token Accounts, and Associated Token Accounts
- Describe the fields and purpose of each account type in the token model
- Understand how token metadata works through the Metaplex Token Metadata Program
- Mint SPL Tokens using both Anchor and TypeScript

## Topics Covered

- Token Program overview
- SPL Token fundamentals: Mint Accounts and Token Accounts
- Mint Account structure and fields
- Token Account structure and fields
- Associated Token Accounts (ATAs)
- Token Metadata via Metaplex
- Minting SPL Tokens using Anchor and TypeScript

## Slides

[SPL Token slides](https://docs.google.com/presentation/d/1GplcrkUwb2P8fb2_dtCybcnptMPGluefKhCvZbLHwUA/edit?usp=sharing)

---

## 1. Token Programs

Token Programs contain all the instruction logic for interacting with tokens on the Solana network. The ecosystem has two main Token Programs:

- **Token Program** - The original token standard
- **Token Extensions Program (Token-2022)** - The next-generation token standard with additional functionality

All mint accounts and token accounts on Solana are owned by one of these two programs.

## 2. SPL Tokens

Tokens on Solana are referred to as **SPL Tokens**. Each token is uniquely identified by the address of its **Mint Account**, which is owned by the Token Program.

The token system relies on two primary account types:

- **Mint Accounts** - Represent a specific token and store global metadata
- **Token Accounts** - Track individual ownership of tokens for a specific mint and owner

## 3. Mint Accounts

Mint Accounts are unique addresses owned by the Token Program. They represent a specific token and store its global configuration.

**Mint Account Fields:**

| Field | Description |
|-------|-------------|
| **Supply** | Total supply of the token |
| **Decimals** | Decimal precision of the token |
| **Mint Authority** | The account authorized to create new units of the token |
| **Freeze Authority** | The account authorized to freeze tokens in a Token Account |

**Account metadata:**
- `Data`: Token configuration as described above
- `Executable`: False
- `Owner`: Token Program

## 4. Token Accounts

Token Accounts are unique addresses owned by the Token Program. They track individual ownership of a specific token.

**Token Account Fields:**

| Field | Description |
|-------|-------------|
| **Mint** | The token (Mint Account) this Token Account holds units of |
| **Owner** | The account authorized to transfer, burn, or delegate tokens |
| **Amount** | Number of tokens currently held |

**Account metadata:**
- `Data`: Ownership and balance data as described above
- `Executable`: False
- `Owner`: Token Program

**Important distinction:** Mint Accounts and Token Accounts are separate. The Mint Account represents the token itself and stores global metadata (total supply, decimals, authority), while Token Accounts track individual ownership between a specific mint and a specific owner.

## 5. Associated Token Accounts (ATAs)

An Associated Token Account is the **default token account** for a given wallet and mint combination.

The Associated Token Program creates a deterministic PDA by deriving the address of the ATA from three inputs:
1. The wallet address
2. The token program
3. The mint address

The **Token Program** still owns the ATA - the Associated Token Program only derives the address of the PDA. This deterministic derivation means that given a wallet and a mint, anyone can compute the expected ATA address without querying the network.

## 6. Token Metadata - Metaplex

SPL Tokens do not natively include metadata such as a name, symbol, or image. The Metaplex **Token Metadata Program** addresses this by creating a **Metadata Account** deterministically derived from the mint address.

**How it works:**
- The name and symbol are stored on-chain directly in the Metadata Account
- The Metadata Account accepts a **URI** pointing to an off-chain JSON file containing additional metadata (image, description, attributes, etc.)
- Each token can have one and only one Metadata Account
- The PDA is derived from `["metadata", program_id, mint_address]`, where `program_id` is the Token Metadata Program address
- The Metadata Account is owned by the Token Metadata Program

**Metadata Account Fields:**

| Field | Description |
|-------|-------------|
| **Name** | Display name of the token |
| **Symbol** | Short symbol (e.g., USDC, SOL) |
| **URI** | Link to off-chain JSON metadata |
| **Seller Fee** | Royalty percentage (basis points) |
| **Creators** | List of creator addresses and shares |

**Note:** Mint accounts owned by the Token Extensions Program can store metadata directly on-chain using the Metadata extension, without requiring the Metaplex program.

## 7. Metadata Account Details

- Each token can have one (and only one) Metadata Account
- The PDA is derived from `["metadata", program_id, mint_address]`
- Owned by the Token Metadata Program
- Can be upgradable

---

## Code Example

See the [examples/](examples/) folder for reference code for this module.

[PLACEHOLDER - Add example code to examples/]

## Hands-On Exercises

[PLACEHOLDER - Module 3 Exercises]

## Challenge

See the [challenge/](challenge/) folder for this module's challenge.

[PLACEHOLDER - Add challenge to challenge/]

## Additional Resources

- [Solana Token Basics](https://solana.com/docs/tokens/basics)
- [Token Program Examples](https://github.com/solana-developers/program-examples/tree/main/tokens)
- [Metaplex Token Metadata](https://solana.com/docs/tokens/metaplex)
- [Metaplex Documentation](https://www.metaplex.com/docs/smart-contracts/token-metadata)
