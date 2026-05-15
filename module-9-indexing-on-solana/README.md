# Module 9: Indexing on Solana

## Learning Objectives

By the end of this module, participants will be able to:

- Explain why direct RPC queries are insufficient for production applications and why custom indexes are necessary
- Differentiate between raw and parsed transaction data and understand why parsing is essential for business logic
- Describe Solana's Geyser plugin interface and how Yellowstone gRPC enables sub-100ms real-time data streaming
- Compare indexing frameworks (Carbon, Vixen) and select the appropriate one for a given use case
- Design a backfill strategy using getTransactionsForAddress, getSignaturesForAddress, or getBlock depending on data requirements
- Choose between SQL databases, columnar databases, and data lakes based on query patterns, dataset size, and latency needs
- Implement a real-time sync pipeline using LaserStream or Enhanced WebSockets to keep an index current
- Build a complete indexer lifecycle: backfill historical data, parse and transform it, store it, and stream updates

## Topics Covered

- Why indexing matters for enterprise applications
- Raw vs parsed transaction data
- Backfilling historical data (three methods)
- Storage strategies (SQL, columnar, data lakes)
- Yellowstone gRPC and the Geyser plugin interface
- Indexing frameworks: Carbon and Vixen
- Real-time streaming: LaserStream and Enhanced WebSockets
- Production indexer architecture

## Slides

[Indexing on Solana Slides](https://docs.google.com/presentation/d/1L9-0ysJwsv8aAsd9l-g9nr_PIEBcnf9Itrp2YXtCmyA/edit?usp=sharing)

---

## 1. Why Indexing Matters

The Solana blockchain stores data in a sequential, append-only ledger. This design is excellent for data integrity and transaction throughput, but it makes querying historical data extremely inefficient. For enterprise applications that need to filter, aggregate, or join data from multiple sources, querying the chain directly is impractical.

Standard RPC methods like `getSignaturesForAddress` and `getTransaction` work for low-volume verification, but production systems hit real limitations quickly.

**Rate limits.** Public and even paid RPC endpoints have query limits. A payment processor handling thousands of transactions per hour will exhaust those limits.

**No persistence.** RPC gives you current state, not historical analytics. There is no built-in way to query all transfers for a given token mint over the last 90 days.

**Polling overhead.** Repeatedly calling `getSignaturesForAddress` to detect new transactions is inefficient and introduces latency. Every poll that returns no new results is wasted compute.

**Coarse granularity.** Pre/post balance snapshots from RPC do not reveal individual transfers within complex transactions. A single transaction can contain multiple token transfers, memo instructions, and CPI calls - RPC treats it as one opaque unit.

Indexing solves these problems by ingesting blockchain data at the source and exposing it through purpose-built APIs and databases.

## 2. What Indexing Means in Practice

An indexer typically does four things:

1. **Backfill historical data** - Query all historical data relevant to your application using archival RPC methods
2. **Stream new data** - Process new blocks as they are confirmed by the network
3. **Parse and transform** - Extract relevant fields from confirmed blocks (transactions, state changes, token transfers, memos)
4. **Store in a database** - Organize the data into a queryable database optimized for your access patterns

### Why Companies Build Custom Indexes

Every company's data needs are different. A wallet needs fast token balance lookups. A trading desk needs complete trade history for backtesting. A payment processor needs real-time transfer monitoring with memo extraction for reconciliation.

**Wallet example.** Querying `getTokenAccountsByOwner` and `getTokenAccountBalance` on every page load is too slow. Wallets maintain their own indexes of customer addresses, tokens, and balances for instant response times.

**Trading example.** A crypto trading firm logging all activity on a specific trading pair (SOL-USDC) for algorithm backtesting cannot scan the blockchain in real time. They build purpose-built indexes and keep them updated with streaming infrastructure.

**Payment processing example.** A payment processor needs to detect incoming USDC transfers to merchant wallets, extract memo fields for invoice matching, and trigger fulfillment workflows - all within seconds. Polling RPC is not fast enough and does not provide the parsed granularity needed.

**PnL calculation.** Computing a trader's profit and loss requires finding every wallet transaction in a timeframe, filtering swaps, labeling buys and sells, fetching historical prices, and aggregating results. With an index, this becomes a single API call.

## 3. Raw vs Parsed Transaction Data

Before choosing an indexing approach, it is important to understand what Solana transactions actually contain.

**Raw transaction data** uses compact binary encoding. Accounts are referenced by indices into the transaction's account list, and instruction data appears as opaque Base58-encoded bytes. A raw instruction looks like a program ID index, an array of account indices, and an encoded data blob. Without decoding, it is meaningless to business logic.

**Parsed transaction data** resolves those references into human-readable structures: transfer type, source and destination wallet addresses, decimal-adjusted token amounts, and mint addresses. This is what your application actually needs.

Parsing is essential for payment systems. You need decimal-adjusted amounts (not raw lamports), resolved wallet addresses (not account indices), extracted memo fields (not encoded bytes), and identified transfer types.

## 4. Backfilling Historical Data

The first step in building an index is populating it with historical data. There are three main approaches, each suited to different access patterns.

### Method 1: getTransactionsForAddress (Recommended)

This method fetches full transaction details for an address with powerful filtering. You set a timeframe, configure token account inclusion, and paginate through results. On each page, you extract relevant data and store it.

Advantages: single-call simplicity, slot and time-based filters, token account support, reverse search for chronological ordering, and lower credit cost than alternatives.

### Method 2: getSignaturesForAddress + getTransaction

The traditional approach before getTransactionsForAddress existed. You recursively loop over signatures using `getSignaturesForAddress` (newest to oldest), storing the last signature as a cursor, then call `getTransaction` for each signature to get full details.

Downsides: requires one additional RPC call per transaction, forces newest-to-oldest ordering, needs thread-safe queuing for concurrency, requires manual retry/backoff logic, and does not include associated token account transactions.

### Method 3: getBlock

Most effective when a high percentage of transactions in your target blocks are relevant - for example, indexing a heavily used program like Token Program or a DeFi protocol. You convert a time range to slot numbers, fetch blocks sequentially, and filter for relevant transactions within each block.

This method is inherently wasteful when only a small fraction of block transactions are relevant to your index. Use it only for high-frequency programs or when address-based filtering cannot capture your target data.

## 5. Storage Strategies

Your storage choice depends on dataset size, latency requirements, query patterns, and team expertise.

### SQL Databases (PostgreSQL)

Recommended for most use cases. SQL is flexible, well-understood, and modern PostgreSQL can scale beyond 100M+ rows while offering ACID compliance, complex joins, and secondary indices.

A typical token transfers table includes columns for slot, timestamp, signature, token mint, source address, destination address, amount, and decimals. Indexes on source_address, destination_address, and token_mint enable fast lookups. Partial indexes (for example, on high-value transfers only) further optimize specific query patterns.

Use SQLite for prototyping and PostgreSQL for production.

### Columnar Databases (ClickHouse, Cassandra)

Optimized for analytical queries, aggregations, and high-volume time-series data. If you need to index billions of transactions, columnar databases are the right choice.

**ClickHouse** excels at fast reads, aggregations, and time-series analysis. Tables use the MergeTree engine with partitioning by month and ordering by (token_mint, date) for efficient range queries. Automatic compression reduces storage costs by 10-20x. Materialized views pre-compute common aggregations like daily transfer volumes.

**Cassandra** is ideal for extremely high write throughput, horizontal scaling, and fault tolerance - perfect for continuous ingestion of Solana data.

### Data Lakes (Parquet + Athena)

For massive amounts of raw and processed data for long-term archival and ad-hoc analysis. You store Parquet files in S3 partitioned by date and query them with Amazon Athena using standard SQL. Only recommended when querying large amounts of unstructured data - SQL databases are better for most use cases.

## 6. Real-Time Streaming with Geyser and Yellowstone

Geyser is Solana's plugin interface for streaming real-time account and transaction data directly from validators. Instead of polling RPC, you subscribe to a stream that pushes updates as they are processed - providing sub-100ms latency compared to 200-400ms for WebSocket subscriptions.

**Yellowstone gRPC** is one of the most widely used implementations of the Geyser plugin interface. It streams account updates, transactions, entries, block notifications, and slot notifications.

To use Yellowstone, you need a gRPC endpoint from an RPC provider such as Triton, Helius, QuickNode, or Alchemy. You create a subscription client, define filters (for example, filtering transactions that include the Token Program), and process updates as they arrive.

Yellowstone returns raw Protocol Buffer data, not JSON. You need to decode binary instruction data using program IDLs or parsing libraries - which is where indexing frameworks come in.

## 7. Indexing Frameworks

### Carbon

Carbon is a Rust framework for building production indexers on top of Yellowstone gRPC. Its pipeline architecture connects data sources to decoders to custom processors.

Carbon includes 40+ pre-built decoders for popular programs. For payment systems, the Token Program decoder handles all transfer variants while your processor implements the business logic - matching watched wallets, triggering notifications, or writing to your database.

The architecture is modular: swap data sources (RPC, LaserStream, Enhanced WebSockets), choose decoders for the programs you care about, and implement processors for your specific use case.

### Vixen

Yellowstone Vixen is an open-source Rust framework for transforming raw Yellowstone events into structured, typed data. It uses a Parser + Handler architecture.

**Parsers** deserialize raw Solana events into typed structures. **Handlers** execute business logic on parsed data. **Pipelines** connect parsers to handlers in configurable flows.

Vixen includes built-in parsers for SPL Token and Token-2022, with support for generating parsers from any Solana IDL. For payment monitoring, the token parser gives typed access to transfers, mints, and account states.

## 8. Keeping Your Index Up to Date

After backfilling, you need real-time streaming to keep the index current with new blockchain activity.

### LaserStream (Recommended)

LaserStream is purpose-built for reliable, ultra-low-latency, fault-tolerant data streaming. Key advantages:

**24-hour historical replay.** If your indexer disconnects, LaserStream automatically replays all missed transactions from where you left off. No gap detection logic needed on your side.

**Automatic reconnection.** SDKs in Rust, Go, and TypeScript handle network interruptions seamlessly.

**Node failover.** Your connection aggregates data from multiple nodes simultaneously for maximum uptime.

Best practices for LaserStream subscriptions: narrow your filter to only the data you need, use the `confirmed` commitment level (balances latency and finality), set `failed: false` unless you need failed transactions, and exclude vote transactions.

### Enhanced WebSockets

A cost-effective alternative to LaserStream gRPC for applications that can tolerate occasional data gaps. Powered by the same infrastructure as LaserStream but without historical replay guarantees - if the WebSocket disconnects, you need to manually detect and backfill gaps.

Use Enhanced WebSockets for prototyping, non-mission-critical streaming, or when budget constraints are significant.

## 9. Production Indexer Architecture

A production-grade Solana indexer combines all of these components into a coherent system.

**Backfill layer.** Uses getTransactionsForAddress (or getBlock for high-frequency programs) to populate the database with historical data. Runs as a one-time or periodic batch job.

**Streaming layer.** LaserStream or Yellowstone gRPC subscription pushes new transactions in real time. Filters are set as narrow as possible to minimize processing overhead.

**Parsing layer.** Carbon or Vixen decodes raw protocol buffer data into typed structures. Pre-built decoders handle Token Program, Token-2022, and other common programs. Custom decoders handle application-specific programs.

**Storage layer.** PostgreSQL for most use cases, ClickHouse for analytics-heavy workloads at billions-of-rows scale, or S3 + Athena for long-term archival.

**Application layer.** Your business logic queries the database rather than the blockchain. Balance lookups, transfer history, PnL calculations, and payment reconciliation all become fast database queries.

The result: an application that can answer complex queries about on-chain data in milliseconds, handle thousands of concurrent users, and stay synchronized with the blockchain in near real-time.

---

## Code Example

[PLACEHOLDER - Module 9 Code Example]

## Hands-On Exercises

[PLACEHOLDER - Module 9 Exercises]

## Additional Resources

- [Solana Payments Indexing Documentation](https://solana.com/docs/payments/accept-payments/indexing)
- [How to Index Solana Data - Helius](https://www.helius.dev/docs/rpc/how-to-index-solana-data)
- [Yellowstone gRPC Repository](https://github.com/rpcpool/yellowstone-grpc)
- [Carbon Framework](https://github.com/sevenlabs-hq/carbon)
- [Yellowstone Vixen](https://github.com/rpcpool/yellowstone-vixen)
- [Triton Streaming Documentation](https://docs.triton.one/chains/solana/streaming)
- [LaserStream Quickstart](https://www.helius.dev/docs/laserstream)
- [Solana RPC Providers](https://solana.com/rpc)
