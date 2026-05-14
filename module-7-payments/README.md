# Module 7: Payments on Solana

## Learning Objectives

By the end of this module, participants will be able to:

- Identify the limitations of traditional payment infrastructure and how Solana addresses them
- Map traditional payment concepts (account numbers, currencies, balances) to their Solana equivalents
- Explain how wallets, Associated Token Accounts, and the Token Program work together to process payments
- Describe how fee payer abstraction enables blockchain-invisible payment experiences for end users
- Construct batch payment transactions and understand their atomicity guarantees
- Articulate enterprise payment use cases including payroll, cross-border settlement, and trade finance

## Topics Covered

- Limitations of traditional payment rails
- Why Solana for enterprise payments
- Mapping traditional concepts to Solana primitives
- Wallets, ATAs, and payment flows
- Fee payer abstraction and user experience
- Batch payments and transaction atomicity
- Enterprise use cases

## Slides

[Payments on Solana slides](https://docs.google.com/presentation/d/1r0NH_Wl8IaxayDh_cKcUzPIfKqaiCahvILANlokdHgg/edit?usp=sharing)

---

## 1. The Problem with Traditional Payment Rails

The global payments infrastructure is built on technology from the 1970s through the 1990s. Enterprises are paying for that in friction, cost, and latency every single day.

**Settlement latency.** Card networks settle T+1 to T+2. ACH takes 1-3 business days. SWIFT international wires can take 3-5 days.

**Fee burden.** Card processing fees run 2.5-3.5% per transaction. SWIFT transfers carry $25-50 in wire fees per leg. ACH is cheaper but slow.

**Limited programmability.** Legacy payment rails cannot embed compliance logic, enforce transfer restrictions, or automate tax withholding in the payment itself.

**Cross-border friction.** International transfers involve correspondent banks, compliance checks at every hop, and unpredictable FX conversion rates.

A $10,000 cross-border payment through the traditional system costs roughly $87-175+ in fees, incurs a 1-3% FX spread, takes 3-5 business days, and passes through 5 intermediaries.

## 2. Why Solana for Enterprise Payments

Solana solves these pain points and delivers the performance characteristics needed to process institutional-scale payment volume.

**Instant settlement.** Funds are secured in approximately 400ms and confirmed with supermajority consensus in seconds. The receiver can act on the funds immediately.

**Sub-cent fees.** The median fee is under $0.001 per transaction. Multiple payments can be batched into a single transaction, further reducing cost per transfer.

**Local fee markets.** Solana's fee architecture isolates payment transactions from unrelated network congestion, providing predictable costs.

**Programmable compliance.** Payments on Solana are programmable. Token Extensions enable compliance checks - KYC gates, transfer restrictions, memo requirements - natively with every token.

The same $10,000 payment on Solana: confirmed in 400ms, fee of approximately $0.001, atomic (all-or-nothing), no intermediaries.

## 3. Mapping Traditional Concepts to Solana

Before walking through the payment flow, it is helpful to map every Solana concept to its traditional payments equivalent.

| Traditional Concept | Solana Equivalent | What It Means |
|---------------------|-------------------|---------------|
| Customer ID / Account number | Wallet address | Unique identifier for an account holder |
| Currency (USD, EUR) | Token Mint (USDC, PYUSD, USDG) | The asset type being transferred |
| Balance per currency | Associated Token Account (ATA) | Holds a balance of a specific currency/mint |

**Wallet address** - A unique 32-byte identifier, safe to share publicly. Equivalent to a bank account number that anyone can send to. Deterministic and permanent - no account opening process and no KYC at the protocol layer.

**Token Mint** - Each stablecoin has a unique mint address that identifies the asset type. Just like how USD and EUR are different currencies, USDC and PYUSD are different mints on Solana.

**Associated Token Account** - A wallet does not hold tokens directly. It has one ATA per token type, like having separate sub-accounts for each currency at a bank. ATAs are derived from the wallet address, the mint address, and the token program. Given a wallet and a stablecoin, you can always compute the exact destination account - no need to ask the receiver which account to send to.

## 4. Wallets and Payment Parties

A wallet on Solana is the equivalent of a corporate bank account. It is how an organization holds, sends, and receives funds on the network.

Every payment involves two parties (two wallets):

- **Sender** - The wallet initiating the payment. Must sign the transaction.
- **Receiver** - The destination wallet.
- **Fee payer** (optional) - A separate wallet that pays the transaction fee on behalf of the sender.

### Fee Payer Abstraction

Solana's transaction model allows complete abstraction of the blockchain layer. A custodian can sign and pay for all on-chain transactions on behalf of users. The user interacts exclusively with the existing interface - no wallet, no keypair, no SOL, no awareness of the underlying chain.

The blockchain becomes pure settlement infrastructure, invisible to the end user. This is critical for enterprise adoption - end users do not need to understand or interact with blockchain technology to benefit from it.

## 5. Associated Token Accounts in Payment Flows

An Associated Token Account is a deterministic token account tied to a specific wallet and mint. Given a wallet address and a mint, the ATA address is always the same.

**Key properties for payments:**

- **One ATA per mint** - A wallet has exactly one ATA for USDC, one for USDT, one for PYUSD, and so on.
- **Must exist before receiving** - You cannot send tokens to an ATA that does not exist.
- **Sender typically creates** - If the receiver's ATA does not exist, the sender can create it as part of the payment transaction.

### Payment Flow Example

Alice sends 10 USDC to Bob:

1. Alice's wallet signs the transaction
2. The Token Program verifies Alice's authority over her USDC ATA
3. 10 USDC is debited from Alice's ATA (balance: 100 -> 90)
4. 10 USDC is credited to Bob's ATA (balance: 45 -> 55)
5. The transfer is atomic - it either completes fully or not at all

Alice's other token accounts (such as her USDG ATA with a balance of 1,000 USDG) are unaffected.

## 6. Batch Payments and Transactions

Multiple transfers can be packed into a single transaction - one signature, one base fee, one confirmation. This makes bulk payments faster and cheaper.

**Atomicity.** All instructions in a transaction either succeed together or fail together and roll back. There is no partial execution. You will not end up in a state where recipient 1 got paid but recipient 2 did not.

**Composition.** Each transfer instruction is built independently and then composed at the transaction level. This modular approach makes it straightforward to construct complex payment batches.

**Transaction size limit.** Transactions have an approximately 1,232 byte size limit. Only a limited number of transfer instructions can fit into one transaction before hitting that ceiling.

**Scaling beyond one transaction.** The `@solana/instruction-plans` package handles scaling beyond a single transaction. It allows you to define operations as sequential, parallel, or non-divisible and then automatically packs them into optimally-sized transactions with concurrent sending.

## 7. Enterprise Use Cases

**Payroll and treasury disbursement.** A corporate treasury approves a batch of salary payments in stablecoins - hundreds of transfers packed into a handful of transactions, all settling in under a second with sub-cent fees.

**Fund subscription and redemption settlement.** An asset manager processes investor subscriptions and redemptions through a platform, with the actual token minting, burning, and transferring settling on Solana in real time.

**Supply chain and trade finance payments.** A manufacturer ships goods, the bill of lading is tokenized on-chain, and payment releases automatically when the goods clear customs.

**Cross-border B2B settlement.** A U.S. company pays a supplier in Singapore using USDC on Solana. The payment settles in 400ms with fee payer abstraction so neither party needs to hold SOL. The memo field carries the invoice reference for reconciliation.

---

## Hands-On Exercises

[PLACEHOLDER - Module 7 Exercises]

## Additional Resources

- [Solana Pay Documentation](https://docs.solanapay.com/)
- [Solana Token Basics](https://solana.com/docs/tokens/basics)
- [Token Extensions Documentation](https://solana.com/docs/tokens/extensions)
- [@solana/instruction-plans](https://www.npmjs.com/package/@solana/instruction-plans)
