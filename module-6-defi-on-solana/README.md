# Module 6: DeFi on Solana

## Learning Objectives

- Explain the core DeFi primitives and how they operate on Solana
- Identify the major DeFi protocols on Solana and the role each plays in the ecosystem
- Describe how Automated Market Makers (AMMs), concentrated liquidity, and Central Limit Order Books (CLOBs) work
- Understand lending and borrowing mechanics on Solana, including collateralization and liquidation
- Articulate how enterprises can leverage DeFi infrastructure for treasury management, liquidity, and yield
- Interact with DeFi protocols programmatically using Solana SDKs and CPIs

## Topics Covered

- DeFi fundamentals and why Solana is suited for decentralized finance
- Decentralized exchanges: AMMs, CLOBs, and aggregators
- Lending and borrowing protocols
- Liquid staking
- Yield strategies and vaults
- Enterprise applications of DeFi
- Programmatic interaction with DeFi protocols

## Slides

[DeFi on Solana Slides](https://docs.google.com/presentation/d/1dfxjxkYgLg7nMD7uXt2H-kdEILQOQcvqm-btso--YjM/edit?usp=sharing)

---

## 1. Why DeFi on Solana

Decentralized finance replaces traditional financial intermediaries with on-chain protocols that execute autonomously. The core requirements for viable DeFi infrastructure are speed, low transaction costs, and reliable finality - all areas where Solana excels.

Solana's architecture delivers the performance characteristics that DeFi demands:

- **High throughput** - 5,000+ TPS enables order book-style trading and high-frequency interactions that are impractical on slower chains
- **Sub-second finality** - 400ms block times allow DeFi protocols to respond to market conditions in near real-time
- **Low fees** - Transaction costs below $0.001 make micro-transactions, frequent rebalancing, and complex multi-instruction transactions economically viable
- **Parallel execution** - Non-conflicting DeFi transactions execute simultaneously, reducing congestion during high-volume periods

As of late 2025, Solana's DeFi ecosystem holds over $3.6 billion in total value locked (TVL) across lending markets alone, with 33% year-over-year growth.

## 2. Decentralized Exchanges and AMMs

Decentralized exchanges (DEXs) allow users to swap tokens without a centralized intermediary. On Solana, DEXs operate using three primary models.

### Automated Market Makers (AMMs)

AMMs use liquidity pools instead of order books. Liquidity providers (LPs) deposit token pairs into pools, and traders swap against those pools. Prices are determined algorithmically based on the ratio of tokens in the pool.

**Concentrated Liquidity** is an evolution of the basic AMM model. Instead of distributing liquidity across the entire price range, LPs can deploy capital within specific price ranges. This improves capital efficiency - LPs earn higher fee income, and traders get tighter spreads.

### Central Limit Order Books (CLOBs)

A CLOB is the same model used by traditional stock exchanges and FX markets - a book of buy and sell orders matched by price and time priority. Running an on-chain order book requires placing, canceling, and matching orders as individual transactions, which makes it prohibitively expensive on high-fee chains like Ethereum.

Solana's sub-cent transaction costs and 400ms block times make on-chain CLOBs viable for the first time. For enterprise teams coming from traditional finance, this is one of the most intuitive entry points into DeFi - the mechanics are identical to what they already use, but running on permissionless, 24/7 infrastructure.

**Phoenix** is the leading on-chain CLOB on Solana. It features a fully on-chain order book with deterministic matching, minimal MEV exposure, and atomic settlement. Phoenix is designed for institutional-grade trading with features like self-custodied limit orders and transparent price discovery.

**OpenBook** is the community-maintained successor to the original Serum order book. It provides a permissionless on-chain order book that other protocols can build on top of, serving as shared infrastructure for the ecosystem.

### DEX Aggregation

Rather than routing through a single DEX, aggregators split trades across multiple liquidity sources - AMMs, CLOBs, and other pools - to find the best execution price. This is critical in practice because liquidity is distributed across many protocols and venue types.

### Key Protocols

**Raydium** combines AMM functionality with concentrated liquidity positions. Its TVL reached $2.3 billion in Q3 2025, growing 32.3% quarter-over-quarter. Raydium is a foundational liquidity layer for the Solana ecosystem.

**Jupiter** has evolved from a DEX aggregator into Solana's most comprehensive DeFi platform, processing over $700 million in daily swap volume. Jupiter routes trades across multiple liquidity sources including Raydium, Orca, Phoenix, and other DEXs to deliver the best available execution.

**Orca** focuses on concentrated liquidity through its Whirlpools product, offering LPs fine-grained control over their capital deployment.

## 3. Lending and Borrowing

Lending protocols allow users to supply assets to earn yield and borrow assets against collateral. These protocols are the backbone of DeFi - they enable leverage, capital efficiency, and yield generation.

### How It Works

1. **Suppliers** deposit tokens into a lending pool and receive interest-bearing receipt tokens
2. **Borrowers** post collateral and borrow from the pool, paying interest over time
3. **Liquidation** occurs if a borrower's collateral value falls below a required threshold, protecting suppliers from bad debt

Interest rates are typically determined algorithmically based on the utilization rate of each pool - as demand for borrowing increases, rates rise to attract more supply.

### Key Protocols

**Kamino Finance** maintains the largest DeFi TVL on Solana at $2.8 billion. Kamino 2.0 introduced K-Lend, a fully integrated lending application with a Market Layer and curator-managed Vault Layer for institutional-grade risk management.

**MarginFi** differentiates through its multi-market structure: interconnected core asset markets, isolated pools for higher-risk tokens, and dedicated liquid staking collateral options. It emphasizes sophisticated risk management systems and capital efficiency through leverage and composability.

### Enterprise Relevance

Lending protocols are directly relevant to enterprise treasury operations. An organization holding stablecoins or tokenized assets can supply them to earn yield, or use them as collateral to access working capital without liquidating positions.

## 4. Liquid Staking

Liquid staking allows SOL holders to stake their tokens and participate in network security while receiving a liquid receipt token (LST) that represents their staked position.

**Why it matters:** Traditional staking locks capital. Liquid staking tokens can be used throughout DeFi - as collateral for borrowing, in liquidity pools, or in yield strategies - while still earning staking rewards.

**Key protocols:** Marinade (mSOL), Jito (JitoSOL), and BlazeStake (bSOL) are the leading liquid staking providers on Solana.

For enterprises, liquid staking offers a way to earn yield on SOL holdings without sacrificing liquidity or operational flexibility.

## 5. Yield Strategies and Vaults

Vaults are automated strategies that deploy capital across multiple DeFi protocols to optimize yield. Instead of manually managing positions across lending, LP, and staking protocols, users deposit into a vault and the strategy executes automatically.

**Common strategies include:**

- **Leveraged lending** - Supply and borrow in a loop to amplify yield on stablecoins or LSTs
- **LP management** - Automated rebalancing of concentrated liquidity positions to stay within optimal price ranges
- **Multi-protocol yield** - Combining staking rewards, lending yield, and LP fees into a single position

Vaults abstract away the complexity of DeFi and are particularly relevant for enterprises that want exposure to on-chain yield without managing individual protocol interactions.

## 6. Enterprise Applications of DeFi

DeFi on Solana is not limited to retail trading. The infrastructure has direct applications for enterprise treasury management, liquidity operations, and financial product design.

### Treasury Management

Organizations holding stablecoins (USDC, PYUSD) or tokenized assets can deploy idle capital into lending protocols or vaults to earn yield, turning a static balance sheet into a productive one.

### Liquidity Provision

Enterprises issuing tokens - whether stablecoins, RWAs, or utility tokens - can seed liquidity on DEXs to ensure their tokens are tradeable. Concentrated liquidity positions allow precise control over the price range and capital commitment.

### On-Chain Settlement

DeFi protocols enable instant settlement between counterparties. A trade, loan, or payment can be executed, collateralized, and settled in a single atomic transaction - eliminating the counterparty risk and delays inherent in traditional settlement.

### Programmatic Access

Unlike traditional finance APIs that vary by institution, DeFi protocols expose a uniform interface. Programs can interact with any DeFi protocol through Cross-Program Invocations (CPIs), enabling enterprises to build custom workflows - automated treasury rebalancing, conditional order execution, or programmatic yield strategies - directly on-chain.

---

## Code Example

See the [examples/](examples/) folder for reference code for this module.

[PLACEHOLDER - Add example code to examples/]

## Hands-On Exercises

[PLACEHOLDER - Module 6 Exercises]

## Challenge

See the [challenge/](challenge/) folder for this module's challenge.

[PLACEHOLDER - Add challenge to challenge/]

## Additional Resources

- [Jupiter Documentation](https://docs.jup.ag/)
- [Kamino Finance Documentation](https://docs.kamino.finance/)
- [Raydium Documentation](https://docs.raydium.io/)
- [MarginFi Documentation](https://docs.marginfi.com/)
- [Marinade Finance Documentation](https://docs.marinade.finance/)
- [Solana DeFi Overview - DeFiLlama](https://defillama.com/chain/Solana)
