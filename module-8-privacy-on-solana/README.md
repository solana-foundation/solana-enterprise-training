# Module 8: Privacy on Solana

## Learning Objectives

By the end of this module, participants will be able to:

- Articulate why full on-chain transparency is a liability for institutional use cases and how it enables MEV, front-running, and competitive exposure
- Describe Solana's three-layer privacy stack: Token-2022 Confidential Balances, Private Channels, and Solana Permissioned Environments
- Explain the cryptographic primitives behind Confidential Transfers - ElGamal encryption, Pedersen commitments, and zero-knowledge range proofs
- Walk through the 8-instruction Confidential Transfer lifecycle from mint creation to withdrawal
- Differentiate between public and encrypted balance states in a confidential token account
- Describe how the auditor key pattern enables selective disclosure for regulatory compliance without sacrificing privacy
- Explain the Private Channels architecture - escrow-based deposits, private sequencing, and 100ms settlement batches
- Compare Solana Mainnet with Solana Permissioned Environments across governance, visibility, validator sets, and fee models
- Distinguish confidential computation (Arcium's MPC, Light Protocol's ZK compression) from amount-hiding, and match privacy trust models - ZK proofs, MPC, TEEs - to institutional risk requirements

## Topics Covered

- Why privacy matters for enterprises
- Solana's privacy stack overview
- Token-2022 Confidential Transfers
- Confidential Transfer instruction flow
- Confidential token account state model
- Selective disclosure and the auditor key pattern
- Private Channels payment channels
- Private Channels architecture and transaction pipeline
- Private Channels in practice - banking use case
- Solana Permissioned Environments (SPEs)
- SPE vs Mainnet comparison
- The wider privacy ecosystem - confidential computation (Arcium, Light Protocol)

## Slides

[Privacy on Solana Slides](https://docs.google.com/presentation/d/1TCHMCpv6i3vFZAT68btsTQOMncXXMk1I70hyIZUEHSY/edit?usp=sharing)

---

## 1. Why Privacy Matters

Solana's default model is full transparency - every balance, transfer, and counterparty is publicly visible on-chain. For retail DeFi users this is acceptable. For institutions, it is a serious liability across three dimensions.

**MEV and front-running.** Solana has no public mempool, but transactions are still visible to the leader that orders them, and predictable on-chain flows can be observed and exploited - adversarial ordering, sandwich attacks, and value extraction routed through block-builder/bundle auctions (e.g. Jito). A large treasury movement or trading strategy becomes exploitable the moment it is submitted, even without a gossiped mempool.

**Competitive exposure.** Competitors, regulators, and adversaries can monitor treasury movements, trading strategies, and client flows in real time. A hedge fund's positions, a payroll provider's disbursement schedule, or a corporation's vendor payments are all readable by anyone with a block explorer.

**Regulatory tension.** Paradoxically, full transparency creates compliance challenges. Exposing all customer balances and transaction patterns publicly can conflict with data protection regulations like GDPR, and makes it harder to build products where privacy is a legal requirement.

Solana's privacy stack addresses each of these layers - at the protocol level, at the token level, and at the execution environment level.

## 2. Solana's Privacy Stack

The privacy stack is organized into three layers, each solving a different scope of the problem.

**Token layer - Confidential Balances.** Confidential Balances is the Token-2022 standard for encrypted token state - an umbrella that covers Confidential Transfers (encrypted transfer amounts), Confidential Mint and Burn, and confidential transfer fees. Balances and amounts are encrypted on-chain with (twisted) ElGamal encryption and Pedersen commitments, hidden from public observers while remaining verifiable through zero-knowledge proofs. It is live on Mainnet and composable with other Token-2022 extensions. Note for an enterprise audience: the underlying ZK ElGamal Proof program was disabled in June 2025 after a soundness bug (forgeable proofs) was found, then patched, re-audited, and re-enabled - worth knowing as a maturity signal, though the feature is available again today. Throughout this module, "Confidential Transfer" refers specifically to the transfer operation within the broader Confidential Balances standard.

**Channel layer - Private Channels (formerly Contra).** Private Channels is a private payment channel with direct access to Solana Mainnet liquidity. (The product was rebranded from "Contra"; the codebase and brochure still carry the Contra name.) Transactions inside the channel are completely private - no public mempool, no data leakage. Operators control validation, ordering, access rules, and compliance frameworks. Settlement happens in 100ms batches with zero per-transaction fees.

**Appchain layer - Solana Permissioned Environments (SPE).** SPEs are sovereign appchains built on the Solana Virtual Machine. They run an independent blockchain with permissioned validators, restricted data visibility, and operator-defined compliance rules. No shared blockspace with Mainnet.

## 3. Token Extensions Architecture

Confidential Balances is itself a suite of Token-2022 extensions, not a single feature. It spans confidential **transfers** (encrypted transfer amounts, the focus of Sections 4-6), confidential **mint and burn** (issuance and redemption without revealing quantities), and confidential **transfer fees** (fees that stay encrypted alongside the amounts they apply to). All three share the same cryptographic machinery below. It is important to understand where this suite sits alongside the other Token-2022 extensions participants have already seen.

Available extensions include Transfer Fees, Interest-Bearing Tokens, Non-Transferable Tokens, Transfer Hook, Freeze Authority, and Metadata Extension. Confidential Balances is composable with these - a token can have encrypted amounts and transfer hooks and freeze authority simultaneously.

The key cryptographic primitives:

- **ElGamal encryption** - Amounts are encrypted under the public keys of the sender, recipient, and (optionally) an auditor. Each party can only decrypt amounts relevant to them.
- **Pedersen commitments** - Enable zero-knowledge range proofs that verify an amount is non-negative and within bounds without revealing the actual value. Note the two distinct bounds: transfer *amounts* are capped at 48 bits (a deliberate optimization - it keeps ElGamal decryption, which requires solving a discrete log, tractable), while the balance-sufficiency check (source balance minus transfer) is proven over the full unsigned 64-bit range.
- **Equality proofs** - Certify that all three ciphertexts (sender, recipient, auditor) encode the same value, preventing cheating.

## 4. Confidential Transfer Instruction Flow

The Confidential Transfer lifecycle consists of 8 discrete on-chain instructions, each cryptographically enforced.

**1. Create Mint.** The mint is initialized with the ConfidentialTransferMint extension. An auditor ElGamal public key is optionally set at this stage.

**2. Create Account.** The token account is reallocated to include confidential state. The owner's ElGamal public key is registered via a PubkeyValidityProof.

**3. Mint (public).** Tokens are minted to the public balance first. The confidential path starts from here - you cannot mint directly into confidential balance.

**4. Deposit.** Public balance is moved into the confidential pending balance. From this point, the amount is locked from public view.

**5. Apply Pending Balance.** Pending balance is moved to available balance. This step is required before spending and prevents front-running attacks where an adversary continuously sends micro-amounts to invalidate a proof mid-flight.

**6. Transfer.** The core confidential transfer. The amount is encrypted under sender, recipient, and auditor keys. A range proof and equality proof are bundled inline with the instruction.

**7. Apply Pending (Recipient).** The recipient must call ApplyPendingBalance before they can spend received funds. Same protection as step 5.

**8. Withdraw.** Confidential available balance is converted back to public balance via WithdrawProofData. A range proof is required.

## 5. Confidential Token Account State

A confidential token account maintains two parallel balance systems - the standard public state and the encrypted confidential extension state.

**Public state (visible on-chain):**

- `mint` - Token mint address
- `owner` - Account owner public key
- `delegate` - Optional delegate
- `amount` - Plaintext balance (may be 0 if all funds are in confidential state)

**Confidential extension state:**

- `encryption_key` - Account-specific ElGamal public key, separate from the signing key. This separation is deliberate: the encryption key can be shared with auditors while the signing key never leaves the owner.
- `pending_balance_lo / hi` - Incoming encrypted transfers. Split into low and high components for overflow safety.
- `available_balance` - Spendable encrypted balance. This is the source for transfer proofs.
- `decryptable_available_balance` - AES-GCM ciphertext for fast local balance decryption by the owner.
- `allow_confidential_credits` - Toggle to accept or reject incoming confidential transfers.

The pending/available split is a critical design choice. Incoming funds go to pending first, preventing front-running attacks where an adversary continuously sends micro-amounts to invalidate a sender's proof mid-flight.

## 6. Selective Disclosure and Compliance

Confidential Transfers support regulatory audit without requiring full transparency. The mechanism is the auditor key pattern.

**How it works:**

1. The mint authority sets an `auditor_elgamal_pubkey` at ConfigureMint time.
2. Every Transfer instruction must encrypt the amount under three keys: sender, recipient, and auditor.
3. An equality proof certifies that all three ciphertexts encode the same value - the auditor cannot be cheated.
4. The auditor can decrypt all amounts for that mint. Per-account auditors are also possible via key sharing.

**Transfer instruction structure:**

| Field | Value |
|-------|-------|
| amount_sender | ElGamal(pk_sender, x) |
| amount_receiver | ElGamal(pk_receiver, x) |
| amount_auditor | ElGamal(pk_auditor, x) |
| range_proof | Proves the transfer amount is a valid 48-bit value (0 <= x < 2^48) and that the source has sufficient balance (remaining balance proven over the full 0 <= x < 2^64 range) |
| equality_proof | Proves all three ciphertexts encode same x |

The separation of encryption_key from signing key per account means decryption rights can be delegated without giving signing rights. The auditor key can be updated via `ConfidentialTransferInstruction::ConfigureMint`.

## 7. Private Channels - Private Payment Channels (formerly Contra)

Private Channels is a payment channel with direct access to over $100B in Solana Mainnet liquidity. It provides privacy by default, operator-controlled rules, instant settlement, and zero per-transaction fees.

**Privacy by default.** No public mempool. Transactions inside the channel are completely private - no front-running, no data leakage to external observers.

**Operational sovereignty.** Operators control validation, ordering, access rules, rate limits, and compliance frameworks. Full governance over the channel.

**Instant settlement.** Thousands of transactions per second with 100ms settlement batches. Near-instant finality without waiting for Mainnet block times.

**Mainnet liquidity access.** Assets in Private Channels are locked in a Mainnet escrow program and are always accessible. Withdrawals burn channel tokens and release SPL tokens on Mainnet.

## 8. Private Channels Architecture

The Private Channels architecture connects user wallets to Mainnet through an escrow-based bridge and processes transactions through a 5-stage internal pipeline.

**Bridge flow:**

1. User deposits SPL tokens to the Escrow Program
2. Funds are locked on Solana Mainnet
3. Private transactions execute inside the channel at 100ms batches
4. An indexer/operator monitors deposits and withdrawals on-chain
5. Withdrawals burn channel tokens and release funds from escrow

**5-stage transaction pipeline (inside the channel):**

1. **Dedup** - Filters duplicate transactions via a blockhash-keyed signature cache
2. **SigVerify** - Parallelizes Ed25519 signature verification across workers
3. **Sequencer** - Builds an account dependency DAG for conflict-free batches
4. **Executor** - Runs batches; AdminVM handles privileged operations, GaslessCallback enables zero-fee execution
5. **Settler** - Batches every 100ms with atomic commits to PostgreSQL and Redis

## 9. Private Channels in Practice

A concrete example: how a bank runs a private payment channel for its customers.

**Setup.** The bank creates an SPL or Token-2022 mint on Mainnet, mints tokenized deposits (1:1 USD backed), initializes the Private Channels Escrow Program on Mainnet, spins up the Private Channels payment channel (Docker-based), and links the channel to escrow as the operator.

**Deposit and transact.** Tokens are locked in the Private Channels Escrow Program on Mainnet. Customers receive equivalent balances inside the channel. P2P transfers are instant, private, and carry zero per-transaction fees.

**Withdrawal.** A customer requests withdrawal inside the channel. The Withdrawal Program burns channel tokens. The escrow releases SPL tokens on Mainnet. Optional: batched or confidential transfer settlement.

Key metrics: over $100B in Mainnet liquidity accessible, 100ms settlement batch interval, thousands of transactions per second, and $0 per-transaction channel fees.

## 10. Solana Permissioned Environments (SPE)

SPEs are fully sovereign appchains built on the SVM - Solana's performance with enterprise-grade access control and privacy.

**Sovereign SVM appchain.** An SPE is an independent blockchain running the Solana Virtual Machine. No shared blockspace with Mainnet - full autonomy over consensus, validators, and governance.

**Permissioned validator set.** Operators curate and whitelist validators. All participants are known, vetted, and bound to compliance frameworks. No unverified node can join.

**Configurable privacy.** Data visibility is restricted to authorized participants. Block times, gas tokens, access logic, and compliance hooks are all operator-defined.

**Full SVM compatibility.** Retains Solana's parallel execution, Token-2022 extensions, state compression, and open-source tooling. Programs port trivially from Mainnet.

## 11. SPE vs Mainnet Comparison

| Dimension | Solana Mainnet | Solana Permissioned Environment |
|-----------|---------------|-------------------------------|
| Gas Token | SOL (volatile, tradeable) | Customizable (stablecoin, PGAS, gasless) |
| Blockspace | Shared with all apps | Dedicated - reserved for the environment |
| Block Times | ~400ms (fixed) | Configurable |
| Validator Set | ~1,300 globally distributed | Self-operated / curated consortium |
| Access | Permissionless, open to all | Permissioned - KYC/KYB gating, geofencing |
| Visibility | Fully public and transparent | Restricted to authorized participants |
| Governance | On-chain voting + social consensus | Operator-defined - federated or single entity |

Production deployments of SPEs include Spherenet, Iron Chain, Pythnet, Alphaledger, and Solstice.

## 12. Beyond the Stack - the Wider Privacy Ecosystem

The three layers above (Confidential Balances, Private Channels, SPEs) are the Foundation-built primitives. They all solve a version of "hide the data, keep the addresses visible." A separate class of protocols tackles a harder problem: **confidential computation** - letting parties compute over data that none of them, and no validator, can see in plaintext. This is what unlocks dark pools, sealed-bid auctions, and private lending, where the *logic* must run on inputs that stay secret. Two projects are worth tracking for institutional use, and they rest on different trust models - which is the right lens for evaluating them.

### Arcium - confidential computation via MPC

Arcium is a decentralized network for confidential computation built on **multiparty computation (MPC)**. Program logic executes across a set of nodes that jointly compute a result without any single node ever seeing the plaintext inputs. The trust assumption is therefore "no dishonest majority of nodes colludes" - a different model from the zero-knowledge proofs behind Confidential Balances, where correctness is mathematically verifiable by anyone.

What it enables: dark pools and sealed-bid auctions (orders stay secret until clearing), private lending, and other flows where the computation itself, not just the balances, must be hidden. A confidential SPL token standard extends Arcium to programmable private assets, so encrypted state can be composed into on-chain logic.

Status (as of June 2026): live on **mainnet alpha** (reached February 2026), having processed 900,000+ encrypted computations, with live applications already ranking among Solana's top protocols by revenue. "Alpha" is the operative caveat for an institutional reader - production, but early.

### Light Protocol / Helius - a ZK-compression privacy layer

Light Protocol is being built into what Helius (a major Solana infrastructure provider, which acquired it) calls a **canonical privacy layer for Solana**, built on **ZK compression**. Where Arcium hides computation and Confidential Balances hides amounts, this layer targets encrypted balances and payments, private markets, and the selective disclosure institutions require - aiming to be a general-purpose, developer-facing privacy primitive rather than a single application.

Status (as of June 2026): **announced, not yet live.** Developer access is expected later in 2026. Treat it as a roadmap item, not something to design against today.

### Also in the ecosystem

Worth knowing, each resting on a distinct trust model, so institutions can match the approach to their own risk and regulatory posture:

- **MagicBlock** - hardware-attested confidentiality via trusted execution environments (TEEs), added to existing Solana programs without rewrites. Suited to confidential order books and real-time trading. Trust model: trusted hardware.
- **Bonsol** - zero-knowledge proofs of off-chain computation, verified on-chain. For heavy or private workloads.
- **Noctura and Yona** - shielded-pool anonymity for transfers and swaps (hiding participants, not just amounts), with compliance-oriented disclosure modes.

The takeaway for an architect: privacy on Solana is not one technique but a spectrum of trust models - ZK proofs (verifiable by anyone), MPC (no colluding majority), and TEEs (trust the hardware vendor). Maturity ranges from production-live to announced. Match the model to the threat you actually need to defend against, and confirm each protocol's current production status before relying on it - these move fast.

---

## Code Example

[PLACEHOLDER - Module 8 Code Example]

## Additional Resources

- [Confidential Transfer Documentation](https://solana.com/docs/tokens/extensions/confidential-transfer)
- [Confidential Balances Overview](https://www.solana-program.com/docs/confidential-balances/overview)
- [Private Channels - Solana Launch](https://launch.solana.com/products/private-channels)
- [Arcium](https://www.arcium.com/) - decentralized confidential computation (MPC)
- [Helius - acquiring Light Protocol to build a canonical privacy layer](https://www.helius.dev/) - ZK-compression privacy layer (announced)
