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

The course is divided into instructor-led modules that build on each other and are best completed in sequence, but they can be mixed and matched as needed. The "B" modules (1B, 7B) are companions to their parent module and can be run standalone.

### Module 1 - Solana Overview

**Topics:**
- Why Solana: market position, stablecoin adoption, and enterprise traction
- Solana architecture: Gulf Stream, Sealevel, Turbine, Alpenglow (Votor) consensus - and what it retired (Proof of History, Tower BFT)
- Key differences from EVM: stateless programs, parallel execution, no re-entrancy
- The Solana data model: accounts, programs, rent, and compute units
- Transactions, instructions, and the lifecycle of a transaction
- Program Derived Addresses (PDAs)
- Fee model: base fees, priority fees, and rent

**Slides:** 
[Link to Solana Overview slides](https://docs.google.com/presentation/d/1C4mEhjs83HvIVG_VeXH30I4m5h2hGK9vjOiKWf63TSM/edit?usp=sharing)

### Module 1B - From EVM to SVM

Companion to Module 1 for EVM-native teams; runnable as a standalone session.

**Topics:**
- The mental-model shift: "you bring the state" - stateless programs and caller-supplied accounts
- Account model translation: storage slots, mappings, and PDAs; msg.sender vs Signer
- ERC-20 vs SPL Token: Mint, Token Account, and ATA
- Composability: call vs CPI and the account-graph propagation rule
- Reentrancy as a structural property; the Solana program security checklist
- Transactions in practice: blockhash expiry, versioned transactions, ALTs, compute budget, priority fees, local fee markets
- Commitment levels as a decision framework
- Client tooling and developer workflow mapped to EVM analogs

**Slides:** [Link to From EVM to SVM slides - PLACEHOLDER]

### Module 2 - Rust Concepts & Anchor

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

**Topics:**
- Limitations of traditional payment rails: settlement latency, fees, programmability, cross-border friction
- Why Solana for enterprise payments: instant settlement, sub-cent fees, local fee markets, programmable compliance
- Mapping traditional payment concepts to Solana primitives: wallets, token mints, ATAs
- Wallets, payment parties, and fee payer abstraction
- Associated Token Accounts in payment flows
- Batch payments, transaction atomicity, and scaling
- Enterprise use cases: payroll, fund settlement, supply chain payments, cross-border B2B

**Slides:** [Link to Payments slides - PLACEHOLDER]

### Module 7B - Subscriptions and Recurring Payments

**Topics:**
- Pull payments on a push-only chain; why the raw SPL Token delegate is insufficient
- The design space: delegate + crank, pre-funded escrow, permanent delegate, streaming, payment channels
- The Subscriptions Delegation Program and the Subscription Authority (one delegate, many authorizations)
- Fixed delegation (allowances), recurring delegation (resetting limits), subscription plans (merchant terms, subscribers, pullers)
- Lifecycle: cancel, cancel-now, resume, revoke; stale-approval action binding
- Token-2022 interactions: supported hooks, rejected extensions, and what that means for the Module 5 MMF mint
- Operating a collector: scheduling, failure taxonomy, dunning vs. compliance holds, events
- Choosing between x402 per-request, channels, and subscriptions

**Slides:** [Subscriptions slides](https://docs.google.com/presentation/d/1BPzIbxFOhRvmoB7Qwcpcmib2eSL7WFlht6LGYzJQjkc/edit?usp=sharing)

### Module 8 - Privacy on Solana

**Topics:**
- Why privacy matters for enterprises
- Solana's privacy stack overview
- Token-2022 Confidential Transfers: instruction flow and confidential token account state
- Selective disclosure and the auditor key pattern
- Private Channels: architecture, transaction pipeline, banking use case, comparison with Mainnet
- The wider privacy ecosystem: confidential computation (Arcium, Light Protocol)

**Slides:**
[Privacy on Solana slides](https://docs.google.com/presentation/d/1TCHMCpv6i3vFZAT68btsTQOMncXXMk1I70hyIZUEHSY/edit?usp=sharing)

### Module 9 - Indexing on Solana

**Topics:**
- Why indexing matters for enterprise applications
- Raw vs parsed transaction data
- Backfilling historical data: three methods
- Storage strategies: SQL, columnar, data lakes
- Yellowstone gRPC and the Geyser plugin interface
- Indexing frameworks: Carbon and Vixen
- Real-time streaming: LaserStream and Enhanced WebSockets
- Production indexer architecture

**Slides:**
[Indexing on Solana slides](https://docs.google.com/presentation/d/1L9-0ysJwsv8aAsd9l-g9nr_PIEBcnf9Itrp2YXtCmyA/edit?usp=sharing)

### Module 10 - Agentic Payments

**Topics:**
- Why AI agents need programmatic payment rails; where traditional rails fail
- The friction problem: accounts, API keys, and broken agent workflows
- Why Solana: sub-cent fees, sub-second finality, stablecoin settlement
- The x402 protocol: HTTP 402, PaymentRequirements, the X-PAYMENT header
- The payment flow: request, 402 challenge, signed payment, verify, settle, respond
- Facilitators: what they abstract and the dependencies they introduce
- Server-side and client-side implementation patterns
- Verification and security: untrusted transactions, simulation, balance verification
- pay.sh and the x402 tooling ecosystem (Corbits, MCPay, PayAI, Coinbase, ACK, A2A)
- Enterprise use cases: API metering, MCP monetization, agent-to-agent commerce

**Slides:**
[Agentic Payments slides](module-10-agentic-payments/Agentic%20Payments%20-%20Slides.pptx)

### Module 11 - Security on Solana

**Topics:**
- The Solana runtime security model: what the platform guarantees vs. the program author's responsibility
- Thinking like an attacker: the malicious transaction and account substitution
- The program security checklist: ownership, signers, substitution, type confusion, arithmetic, CPI safety, account closing, PDA canonicalization, duplicate accounts
- Anchor as a security tool and its limits
- Token security: authorities, delegates, and Token-2022 extension interactions
- Case studies: Wormhole, Cashio, Mango Markets, Slope
- Operational security: upgrade authority lifecycle, key management, monitoring, incident response
- Economic security: oracles and market manipulation
- The audit process and security development lifecycle

**Slides:** [Security on Solana slides](module-11-security-on-solana/Security%20on%20Solana%20-%20Slides.pptx)

## Assessment Approach

Specific modules includes a hands-on challenge that requires participants to apply the concepts covered.
Challenges serve as both a learning exercise and a competency check.
