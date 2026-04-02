# Module 5: Real World Assets on Solana

## Learning Objectives

- Articulate the market opportunity for tokenized real world assets and why institutional adoption is accelerating
- Explain what tokenization does and the capabilities it unlocks over traditional financial rails
- Compare blockchain platforms for RWA issuance and identify why Solana is positioned as the leading choice
- Map Token Extensions features to specific compliance and regulatory requirements
- Identify the major asset classes being tokenized and the live products already in production on Solana
- Describe how tokenized assets compose with DeFi protocols to unlock new financial primitives

## Topics Covered

- The tokenization opportunity and institutional momentum
- What tokenization enables: programmable, 24/7, fractional, composable instruments
- Blockchain platform comparison for RWAs
- Token Extensions as compliance infrastructure
- Asset classes suited for tokenization
- Live proof points on Solana
- DeFi composability with tokenized assets

## Slides

[RWAs on Solana Slides]((https://docs.google.com/presentation/d/16y_jKuaxeoiWLZlFzESOXqQ2Z1ij9G3t0PKLVvf55-8/edit?usp=sharing))

---

## 1. The $16 Trillion Opportunity

BCG projects $16 trillion in tokenized assets by 2030. This is not a speculative thesis - it is a third-party analyst projection grounded in credible research and backed by institutional action.

BlackRock, Franklin Templeton, and Fidelity are already moving assets on-chain in production. When the world's largest asset managers are live, the question is no longer "if" but "where and how fast."

Tokenization has moved past the exploratory phase. The infrastructure is being built and deployed today.

## 2. What Tokenization Does

Tokenization takes an existing asset and places it on better rails. A tokenized asset is the same underlying instrument - a bond, a fund share, a property deed - represented as a programmable on-chain token.

This representation unlocks capabilities that traditional financial infrastructure cannot provide:

- **24/7 settlement** - No more waiting for market hours or T+2 settlement cycles. Transactions settle in seconds, at any time.
- **Fractional ownership** - Assets that were previously only accessible to institutional investors can be divided into smaller units, lowering the barrier to entry.
- **Composability** - Tokenized assets can interact with other on-chain protocols, enabling use cases like collateralized lending, automated yield strategies, and instant liquidity.

An important distinction: the token is not the asset itself. It represents a legal claim on the underlying asset. The legal and regulatory framework around that claim is what makes tokenization viable for regulated finance.

## 3. The Blockchain Choice for RWAs

Not all blockchains are equally suited for tokenized real world assets. The requirements are specific: speed, low fees, native compliance tooling, and a thriving ecosystem.

**Ethereum** offers a deep ecosystem and broad developer familiarity, but high fees and L2 fragmentation create friction for high-volume, low-value transactions common in financial services.

**Private chains** offer full control, but sacrifice composability. Assets locked on a private ledger cannot participate in the broader DeFi ecosystem, limiting their utility and liquidity.

**Solana** provides the combination that regulated finance requires: a public chain with native compliance primitives, proven throughput (5,000+ TPS, 400ms block times), and transaction costs below $0.001. The Token Extensions Program delivers compliance tooling at the protocol level rather than as an afterthought.

## 4. Token Extensions - Compliance by Design

The Token Extensions covered in Module 4 are not abstract features - they are the compliance infrastructure layer that makes regulated asset issuance possible on a public blockchain.

- **Transfer Hooks / ACL** - Enforce allowlists, KYC gates, and jurisdiction rules at every transfer
- **Confidential Transfers** - Encrypted balances with selective disclosure for auditors
- **Permanent Delegate** - Issuer can natively freeze and recover tokens (required in many jurisdictions for sanctioned entities)
- **Required Memo** - Attach ISIN codes, trade IDs, or AML flags natively to every transfer
- **Non-Transferable** - Restrict tokens to original purchasers or KYC-verified holders

These extensions allow issuers to meet regulatory requirements without compromising on the benefits of a public, composable blockchain.

## 5. Asset Classes

The range of assets being tokenized on Solana spans the full spectrum of traditional finance:

- **Money market funds and T-bills** - Low-risk, yield-bearing instruments suitable for institutional treasuries
- **Corporate bonds and credit instruments** - Fixed income products with programmable coupon payments
- **Equities and fund shares** - Fractional ownership of funds and equity positions
- **Real estate** - Commercial and residential property, fractionalized for broader investor access
- **Commodities** - Gold, carbon credits, and other physical assets represented on-chain
- **Trade finance** - Invoices, receivables, and supply chain financing instruments

## 6. Live Proof Points

Tokenized RWAs on Solana are not theoretical - multiple products are live in production today:

- **Franklin Templeton FOBXX** - $380M+ AUM, a money market fund operating fully on-chain
- **Spiko** - EU-regulated UCITS T-bill and money market tokens
- **Ondo USDY** - A yield-bearing stablecoin backed by U.S. Treasury bills
- **Maple Finance** - Institutional credit and undercollateralized lending
- **Homebase** - Tokenized U.S. real estate with fractional ownership via SPL tokens

## 7. DeFi Composability

One of the most powerful aspects of tokenizing assets on a public blockchain is composability with existing DeFi protocols. This creates entirely new financial primitives that are impossible in traditional finance.

**Tokenized T-bills as lending collateral.** An institution holding tokenized T-bills can use them as collateral in protocols like Kamino or MarginFi to borrow USDC instantly - no phone calls, no paperwork, no waiting for settlement.

**Yield-bearing RWAs as LP positions.** Tokenized assets can be deployed into liquidity pools, earning trading fees on top of the underlying yield of the asset itself.

**Instant liquidity.** Token holders can exit positions via secondary markets immediately, rather than waiting for redemption windows or finding a counterparty through traditional channels.

---

## Hands-On Exercises

[PLACEHOLDER - Module 5 Exercises]

## Additional Resources

- [RWA.xyz - Solana RWA Dashboard](https://app.rwa.xyz/networks/solana)
- [Helius - Solana Real World Assets](https://www.helius.dev/blog/solana-real-world-assets)
- [RedStone - Solana RWA Overview](https://blog.redstone.finance/2025/09/29/solana-rwa)
