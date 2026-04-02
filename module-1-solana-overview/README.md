# Module 1: Solana Overview

## Learning Objectives

- Articulate why Solana has emerged as the leading platform for enterprise and financial infrastructure
- Describe Solana's core architecture, including Proof of History, Gulf Stream, Turbine, and Tower BFT
- Identify the key differences between Solana's programming model and EVM-based chains
- Explain the Solana account model, including accounts, programs, rent, and Program Derived Addresses
- Trace the lifecycle of a transaction from client to on-chain execution
- Understand Solana's fee model, including base fees, priority fees, and compute units

## Topics Covered

- Why Solana: market position, developer growth, and enterprise adoption
- Solana architecture and consensus
- Key differences from EVM-based chains
- The Solana data model
- Transactions, instructions, and programs
- Program Derived Addresses (PDAs)
- Compute units and the fee model

## Slides

[Solana Overview slides](https://docs.google.com/presentation/d/1C4mEhjs83HvIVG_VeXH30I4m5h2hGK9vjOiKWf63TSM/edit?usp=sharing)

---

## 1. Why Solana

Solana has established itself as the leading Layer 1 blockchain for startups and enterprises across every key metric: developer growth, application revenue, new asset creation, and trading volume.

Solana is trusted by major stablecoin issuers including Societe Generale, PayPal, Paxos, and Siam Commercial Bank, and has received regulatory approvals from the NY Department of Financial Services (NYDFS) and the Thailand Digital Asset Regulatory Sandbox.

Financial services firms such as Visa, Stripe, and PayPal have chosen Solana for payments and commerce infrastructure, leveraging stablecoin settlement and merchant payment flows built on USDC and PYUSD.

## 2. Understanding Solana

Solana's core insight is a fundamentally different approach to transaction ordering and execution.

Traditional blockchains like Ethereum process transactions sequentially - each must complete before the next begins. This creates a bottleneck: approximately 15 TPS, 12-second block times, and unpredictable fees.

Solana separates ordering from execution. Proof of History (PoH) creates a cryptographic clock that proves the ordering of events mathematically, eliminating the need for validators to negotiate sequence. This enables parallel execution of non-conflicting transactions across multiple cores.

**The result:** 5,000+ TPS, 400ms block times, and fees below $0.001.

## 3. Solana Architecture

Solana's architecture is composed of several interconnected components that work together to achieve high throughput and fast finality.

**Gulf Stream - Transaction Forwarding.** Before a validator becomes leader, other validators and clients already know it is coming thanks to the pre-computed leader schedule. They forward transactions directly to the upcoming leader's memory. By the time the slot starts, the leader has a warm queue ready to execute immediately. There is no idle mempool.

**Block Building - Leader Execution.** The leader takes queued transactions, deduplicates them, and runs them through Sealevel in parallel. As it executes, it weaves the results into the PoH chain - each transaction receives a PoH tick, creating a cryptographic record of ordering and time.

**Turbine - Block Propagation.** The leader cannot send the full block to all validators at once. Turbine breaks the block into small packets and propagates them through a layered tree of validators. Each validator receives its chunk and forwards pieces to a small neighborhood below it - inspired by BitTorrent.

**Block Verification.** Each validator reassembles the block from Turbine chunks, re-executes the transactions independently, and checks that the resulting state matches what the leader claimed. If anything does not match, the block is rejected.

**Consensus - Tower BFT.** Solana uses Tower BFT, a PoH-aware variant of PBFT. Validators cast votes on blocks by locking their stake behind them. The longer a validator has been voting on a particular fork, the longer its lockout period before it can switch. This makes it economically irrational to flip to a different fork late in the process.

## 4. Key Differences from EVM

Understanding the differences between Solana and EVM-based chains is essential for developers transitioning from Ethereum or evaluating Solana for enterprise use.

**Smart Contract Model.** Ethereum's EVM runs one contract at a time in a sandboxed environment. Solana's runtime, Sealevel, executes thousands of smart contracts in parallel by analyzing which accounts each transaction touches and running non-overlapping ones simultaneously.

**State Model.** Ethereum stores state inside smart contracts - the contract owns its storage. Solana separates programs (code) from accounts (data). Programs are stateless; data lives in separate accounts. This makes programs more composable and parallelizable.

**No Re-Entrancy.** On Ethereum, re-entrancy is a runtime problem that developers must guard against (as demonstrated by the 2016 DAO hack). On Solana, the runtime enforces a hard rule: a program cannot be re-entered while it is already in the call stack. This entire class of vulnerability is structurally prevented at the protocol level.

**Parallel Execution.** Solana transactions declare which accounts they will read or write upfront. The runtime uses this to execute non-conflicting transactions simultaneously across multiple cores.

**No Mempool.** Gulf Stream forwards transactions directly to the next expected leader. There is no global mempool.

**Upgradability.** Solana programs are upgradable by default, allowing teams to iterate on deployed programs.

**Fee Model.** Solana uses a base fee per signature (5,000 lamports) plus an optional priority fee, rather than Ethereum's global gas auction.

| Aspect | Ethereum (EVM) | Solana (SVM) |
|--------|----------------|--------------|
| Contract Model | Stateful - contract + state combined | Stateless - program and state separated |
| Execution | Single-threaded | Multi-threaded, parallel |
| Re-Entrancy | Possible - developer must guard against it | Structurally prevented by the runtime |
| Transaction Forwarding | Global mempool | Gulf Stream - direct forwarding to leader |
| Upgradability | Immutable by default (proxy patterns required) | Upgradable by default |
| Fee Model | Global gas auction | Base fee + optional priority fee |

## 5. Accounts

Everything on Solana is an Account. An account is a slice of data stored on the blockchain, uniquely identified by its address. This can be compared to Unix file systems, where everything is a file accessed by its index.

When an account is created, a certain amount of space is allocated and rent must be paid based on that space. The space is dynamic - if additional space is needed, it can be allocated with a corresponding rent increase.

Accounts can only be created by the System Program. After creation, the System Program can transfer ownership of an account to another program.

**Account Structure:**

```json
{
  "key": "PublicKey",
  "lamports": "number",
  "data": "Uint8Array",
  "is_executable": "boolean",
  "owner": "PublicKey"
}
```

**Account Flags:**
- **Writable** - Serial access (one at a time). Required when the account's state will be modified.
- **Read Only** - Parallel access (many at once). Used when the account's data is only being read.
- **Signer** - The account has signed the transaction.
- **Executable** - The account is a program.

## 6. Programs

Programs are a special type of account with the executable flag set to `true`. They are stateless - they do not store data themselves but interact with other accounts on the blockchain to read and write data.

A program can own non-executable accounts. For example, a program that tracks user points would create accounts to store that data, and those accounts would be owned by the program. A program must be the owner of an account in order to modify its state; otherwise, it can only read data.

Programs are managed by the BPF Loader. The latest version is the Upgradeable BPF Loader, which allows programs to be updated after deployment.

**Native Programs** (such as the System Program and SPL Token Program) are provided by Solana. **User Programs** are written and deployed by developers.

## 7. Rent

Data storage on Solana requires a rent deposit. When an account is created, rent must be paid based on the amount of space allocated.

- Pay 2 years of rent upfront to achieve **rent-exemption** (required on account creation)
- **Closing** an account allows the rent deposit to be reclaimed
- **Resizing** an account costs or returns the difference in rent
- **Upgradable programs** require 4 years of rent upfront to ensure sufficient reserves for future upgrades

## 8. Transactions

Transactions are the mechanism for calling methods on Solana programs. They are submitted through an RPC provider and must include all accounts that the transaction will reference.

A transaction is made up of one or more **instructions**. Instructions are the interface to Solana programs - each targets a specific program ID and a specific method. Transactions are **atomic**: if any instruction fails, the entire transaction is reverted and no state change occurs (transaction fees are still charged).

**Transaction Structure:**

```json
{
  "message": {
    "instructions": "Array<Instruction>",
    "recent_blockhash": "number",
    "fee_payer": "PublicKey"
  },
  "signers": "Array<Uint8Array>"
}
```

**Lifecycle of a Transaction:**

1. A user performs an action and a transaction is sent to the RPC client
2. The RPC client routes the transaction to a validator
3. The validator executes the instruction(s) targeting the specified program(s)
4. The program modifies the state of the referenced accounts

## 9. Program Derived Addresses (PDAs)

Program Derived Addresses are one of the most important concepts on Solana. A PDA is an address made up of **seeds** and a **bump** that has no corresponding private key.

Solana uses the ed25519 elliptic curve for key generation. A PDA is an address that falls off this curve, meaning no matching private key exists. This has a powerful consequence: since PDAs have no private key, the program that derived the PDA can **sign on behalf of that account** using the seeds and bump. No other program can sign on behalf of that PDA, because the deriving program's ID is checked during signing.

**Key Properties:**
- Made up of seeds and a bump
- Deterministic if seeds are chosen well (e.g., using a user's wallet key as a seed)
- Can be used as a hashmap (key/value store)
- Cannot collide with PDAs or accounts created by other programs
- Programs can sign on behalf of PDAs they own

**Associated Token Accounts** are a well-known example of PDAs in practice - the ATA address is deterministically derived from the owner's wallet, the token program, and the mint address.

## 10. Compute Units

All on-chain actions require compute units (CUs). Compute units measure the computational resources that a transaction consumes on the network.

| Limit | Value |
|-------|-------|
| Base fee per signature | 5,000 lamports |
| Default CU limit per instruction | 200,000 |
| Built-in instruction default CU | 3,000 |
| Max CU limit per transaction | 1,400,000 |

You can request additional compute units (up to 1.4 million per transaction), but this is generally not advised unless absolutely necessary. Because there is a limit of compute units per block, transactions with large compute unit requests may have a lower chance of being included in a block.

## 11. Fee Model

Solana's fee model differs significantly from Ethereum's global gas auction. On Solana, fees are structured as a local market:

- **Base fee:** 5,000 lamports per signature. This is a fixed cost.
- **Priority fee:** Lamports multiplied by compute units (optional). This functions as a tip to the leader validator.
- **Rent:** A deposit to keep an account alive on-chain. Refundable when the account is closed.

---

## Code Example

See the [examples/](examples/) folder for reference code for this module.

[PLACEHOLDER - Add example code to examples/]

## Hands-On Exercises

[PLACEHOLDER - Module 1 Exercises]

## Challenge

See the [challenge/](challenge/) folder for this module's challenge.

[PLACEHOLDER - Add challenge to challenge/]

## Additional Resources

- [Solana Documentation](https://solana.com/docs)
- [Solana Developer Guides](https://solana.com/developers/guides)
- [Solana Architecture Overview](https://solana.com/docs/intro/overview)
- [Solana Developer Report](https://www.developerreport.com/developer-report)
