# Solana Enterprise Training - Course Plan

## Target Audience

Enterprise development teams, technical architects, and engineering leads evaluating or building on Solana. Participants are expected to have general programming experience; prior blockchain or Rust knowledge is helpful but not required.

## Learning Goals

- Explain Solana's architecture, consensus model, and key differentiators from EVM-based chains
- Navigate the Solana account model, including accounts, programs, transactions, and Program Derived Addresses (PDAs)
- Write and deploy Solana programs using Rust and the Anchor framework
- Work with SPL Tokens, including minting, metadata, and Associated Token Accounts
- Leverage the Token Extensions Program (Token-2022) for enterprise features such as transfer hooks, confidential transfers, and compliance tooling
- Implement permissioned token workflows using Token ACL and Gate Programs

## Course Structure

The course is divided into several modules, each designed for a half-day instructor-led session. Modules build on each other and should be completed in sequence. However, They can be mixed and atched as needed

### Module 1 - Solana Overview

**Duration:** Half-day

**Topics:**
- Why Solana: market position, stablecoin adoption, and enterprise traction
- Solana architecture: Proof of History, Gulf Stream, Turbine, Tower BFT
- Key differences from EVM: stateless programs, parallel execution, no re-entrancy
- The Solana data model: accounts, programs, rent, and compute units
- Transactions, instructions, and the lifecycle of a transaction
- Program Derived Addresses (PDAs)
- Fee model: base fees, priority fees, and rent

**Slides:** 
[Link to Solana Overview slides](https://docs.google.com/presentation/d/1C4mEhjs83HvIVG_VeXH30I4m5h2hGK9vjOiKWf63TSM/edit?usp=sharing)

### Module 2 - Rust Concepts & Anchor

**Duration:** Half-day

**Topics:**
- Rust ownership, borrowing, and references
- Immutability by default
- Structs and data representation
- Introduction to Anchor: what it solves, CLI, and tooling
- Anchor Context, #[derive(Accounts)], and account constraints
- Key constraints: signer, mut, init, init_if_needed, has_one, address, seeds
- Building and testing a Solana program

**Slides:** 
[Link to Rust Concepts & Anchor slides](https://docs.google.com/presentation/d/1ZioRgTA5rqf6ba1XCqXRJlbWx8hFkH_YB971IO8AJ9Y/edit?usp=sharing)

### Module 3 - SPL Tokens

**Duration:** Half-day

**Topics:**
- Token Program overview: Token Program vs. Token Extensions Program
- SPL Token fundamentals: Mint Accounts and Token Accounts
- Mint Account fields: supply, decimals, mint authority, freeze authority
- Token Account fields: mint, owner, amount
- Associated Token Accounts (ATAs) and deterministic derivation
- Token metadata via Metaplex: Metadata Accounts, on-chain and off-chain metadata
- Minting SPL Tokens using Anchor and TypeScript

**Slides:** 
[Link to SPL Token slides](https://docs.google.com/presentation/d/1GplcrkUwb2P8fb2_dtCybcnptMPGluefKhCvZbLHwUA/edit?usp=sharing)

### Module 4 - Token Extensions Program

**Duration:** Half-day

**Topics:**
- Token Extensions Program architecture: TLV data and backward compatibility
- Mint extensions: confidential transfer, transfer fees, closing mint, interest-bearing tokens, non-transferable tokens, permanent delegate, transfer hook, metadata pointer, and metadata
- Account extensions: memo required on transfer, immutable ownership, default account state, CPI guard
- Token ACL (Access Control List): permissioned tokens for enterprise compliance
- Token ACL architecture: Default Account State, Gate Programs, freeze/thaw workflows
- Token ACL vs. Transfer Hooks: when to use each approach

**Slides:** 
[Link to Token Extensions slides](https://docs.google.com/presentation/d/1BgGwCRM-_oOuJEb1_guYS6IwCF_9w2odTIQujs5byvc/edit?usp=sharing)

### Module 5 - RWAs on Solana

**Duration:** Half-day

**Topics:**
- The $16 trillion tokenization opportunity and institutional momentum
- What tokenization enables: programmable, 24/7, fractional, composable instruments
- Blockchain platform comparison for RWA issuance
- Token Extensions as compliance infrastructure for regulated finance
- Asset classes suited for tokenization
- Live proof points: Franklin Templeton, Spiko, Ondo, Maple Finance, Homebase
- DeFi composability with tokenized assets

**Slides:** [Link to RWAs on Solana slides - PLACEHOLDER]

### Module 6 - DeFi on Solana

**Duration:** Half-day

**Topics:**
- DeFi fundamentals and why Solana is suited for decentralized finance
- Decentralized exchanges: AMMs, CLOBs (Phoenix, OpenBook), and concentrated liquidity
- Lending and borrowing protocols: Kamino, MarginFi
- Liquid staking: Marinade, Jito, BlazeStake
- Yield strategies and vaults
- Enterprise applications: treasury management, liquidity provision, on-chain settlement
- Programmatic interactions

**Slides:** [Link to DeFi on Solana slides - PLACEHOLDER]

### Module 7 - Payments on Solana

**Duration:** Half-day

**Topics:**
- Limitations of traditional payment rails: settlement latency, fees, programmability, cross-border friction
- Why Solana for enterprise payments: instant settlement, sub-cent fees, local fee markets, programmable compliance
- Mapping traditional payment concepts to Solana primitives: wallets, token mints, ATAs
- Wallets, payment parties, and fee payer abstraction
- Associated Token Accounts in payment flows
- Batch payments, transaction atomicity, and scaling
- Enterprise use cases: payroll, fund settlement, supply chain payments, cross-border B2B

**Slides:** [Link to Payments slides - PLACEHOLDER]

## Assessment Approach

Each module includes a hands-on challenge that requires participants to apply the concepts covered. Challenges are designed to be completed within the session with instructor support and/or off session in order to consolidate concept.
Challenges serve as both a learning exercise and a competency check.

## Capstone Project

**[PLACEHOLDER - Define capstone project scope]**

Upon completing all modules, participants will have the knowledge and tooling to design and implement a production-grade token system on Solana with enterprise compliance features.
