# Solana Enterprise Training - Teaching Resources

A curated collection of references, tools, and supplementary materials.

## Official Documentation

- [Solana Documentation](https://solana.com/docs) - Primary reference for all Solana concepts
- [Solana Developer Guides](https://solana.com/developers/guides) - Step-by-step guides for common development tasks
- [Anchor Documentation](https://www.anchor-lang.com/docs) - Official Anchor framework documentation (Anchor 1.x; replaces the outdated Anchor Book)

## Protocol Upgrades

- [Solana Upgrades](https://solana.com/upgrades) - Tracker for activated and pending protocol changes (SIMDs, feature gates, dates)
- [Helius - Agave v4.3](https://www.helius.dev/blog/agave-v4-3) - Alpenglow (Votor) activation, removal of vote transactions, Geyser changes
- [Helius - Agave v4.4](https://www.helius.dev/blog/agave-v4-4) - Current stable Agave release
- [p-token](https://solana.com/upgrades/p-token) - SIMD-0266: Pinocchio-based Token Program at the same address, live May 13 2026
- [Larger Transaction Sizes](https://solana.com/upgrades/larger-transaction-sizes) - v1 transactions (up to 4,096 bytes, no ALTs, compute budget in header fields), live Sep 15 2026
- [Reduced Rent](https://solana.com/upgrades/reduced-rent) - SIMD-0437 rent reduction (step 1 live Sep 3 2026; later steps pending)

## Token Programs

- [Solana Token Basics](https://solana.com/docs/tokens/basics) - Official guide to SPL Tokens
- [Token Extensions Documentation](https://solana.com/docs/tokens/extensions) - Full reference for Token-2022 extensions
- [Token Extensions Program Examples](https://github.com/solana-developers/program-examples/tree/main/tokens/token-2022) - Code examples for each extension
- [Metaplex Token Metadata](https://www.metaplex.com/docs/smart-contracts/token-metadata) - Metadata program documentation

## Enterprise and Compliance

- [Solana ACL Guide](https://solana.com/developers/guides/advanced/acl) - Official guide to Access Control Lists
- [Token ACL Repository](https://github.com/solana-foundation/token-acl) - Source code and documentation for Token ACL

## Rust Language

- [The Rust Programming Language](https://doc.rust-lang.org/book/) - The official Rust book
- [Rust By Example](https://doc.rust-lang.org/rust-by-example/) - Learn Rust through annotated examples
- [Rustlings](https://github.com/rust-lang/rustlings) - Interactive exercises for learning Rust

## Development Tools

- [Solana Playground](https://beta.solpg.io/) - Browser-based IDE for writing, building, and deploying Solana programs
- [Solana CLI Tools](https://solana.com/docs/intro/installation) - Installation and setup for the Solana development environment
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) - Installation guide for Anchor
- [Anchor Version Manager (AVM)](https://www.anchor-lang.com/docs/avm) - Manage multiple Anchor versions
- [LiteSVM](https://github.com/LiteSVM/litesvm) - Fast in-process SVM for program tests (default Anchor 1.x test template)
- [Mollusk](https://github.com/anza-xyz/mollusk) - Instruction-level program test harness
- [Surfpool](https://github.com/txtx/surfpool) - Local RPC / validator replacement with mainnet forking (default for `anchor test` / `anchor localnet` in Anchor 1.x)

## Ecosystem and Market Data

- [Solana Developer Report](https://www.developerreport.com/developer-report) - Developer ecosystem metrics
- [Blockworks Solana Analytics](https://blockworks.co/analytics/solana) - On-chain analytics and activity data

## Program Examples

- [Solana Program Examples](https://github.com/solana-developers/program-examples) - Official collection of example programs
- [Token Program Examples](https://github.com/solana-developers/program-examples/tree/main/tokens) - Token-specific examples

## Solana Foundation Curriculum

- [Solana Foundation Curriculum Repository](https://github.com/solana-foundation/curriculum) - Open-source training curriculum
- [Anchor and Programs Course](https://github.com/solana-foundation/curriculum/tree/main/courses/anchor-and-programs) - Detailed weekly modules for Anchor development
- [SPL Tokens 2022 and Extensions Course](https://github.com/solana-foundation/curriculum/tree/main/courses/spl-tokens-2022-and-extensions) - Weekly modules for Token-2022

## Real World Assets (RWAs)

- [RWA.xyz - Solana RWA Dashboard](https://app.rwa.xyz/networks/solana)
- [Helius - Solana Real World Assets](https://www.helius.dev/blog/solana-real-world-assets)
- [RedStone - Solana RWA Overview (Sep 2025)](https://blog.redstone.finance/2025/09/29/solana-rwa)

## DeFi Protocols

- [Jupiter Documentation](https://docs.jup.ag/)
- [Kamino Finance Documentation](https://docs.kamino.finance/)
- [Raydium Documentation](https://docs.raydium.io/)
- [Project 0 Documentation (formerly MarginFi)](https://docs.0.xyz)
- [Marinade Finance Documentation](https://docs.marinade.finance/)
- [Solana DeFi Overview - DeFiLlama](https://defillama.com/chain/Solana)
- [Solana Lending Markets Report - RedStone (Dec 2025)](https://blog.redstone.finance/2025/12/11/solana-lending-markets/)

## Payments

- [Solana Pay Documentation](https://docs.solanapay.com/)
- [@solana/instruction-plans](https://www.npmjs.com/package/@solana/instruction-plans)

## Agentic Payments

- [x402 v2 specification](https://github.com/coinbase/x402/tree/main/specs) - Core spec and HTTP transport (v2 released Dec 11 2025)
- [x402scan](https://x402scan.com/) - x402 ecosystem explorer and analytics

## Slide Decks

- [Solana Overview Slides](https://docs.google.com/presentation/d/1C4mEhjs83HvIVG_VeXH30I4m5h2hGK9vjOiKWf63TSM/edit?usp=sharing)
- [Rust Concepts & Anchor Slides](https://docs.google.com/presentation/d/1ZioRgTA5rqf6ba1XCqXRJlbWx8hFkH_YB971IO8AJ9Y/edit?usp=sharing)
- [SPL Token Slides](https://docs.google.com/presentation/d/1GplcrkUwb2P8fb2_dtCybcnptMPGluefKhCvZbLHwUA/edit?usp=sharing)
- [Token Extensions Program Slides](https://docs.google.com/presentation/d/1BgGwCRM-_oOuJEb1_guYS6IwCF_9w2odTIQujs5byvc/edit?usp=sharing)
- [RWAs on Solana Slides](https://docs.google.com/presentation/d/16y_jKuaxeoiWLZlFzESOXqQ2Z1ij9G3t0PKLVvf55-8/edit?usp=sharing)
- [DeFi on Solana Slides](https://docs.google.com/presentation/d/1dfxjxkYgLg7nMD7uXt2H-kdEILQOQcvqm-btso--YjM/edit?usp=sharing)
- [Payments on Solana Slides](https://docs.google.com/presentation/d/1r0NH_Wl8IaxayDh_cKcUzPIfKqaiCahvILANlokdHgg/edit?usp=sharing)
- [Subscriptions Slides](https://docs.google.com/presentation/d/1BPzIbxFOhRvmoB7Qwcpcmib2eSL7WFlht6LGYzJQjkc/edit?usp=sharing)
- [Privacy on Solana Slides](https://docs.google.com/presentation/d/1TCHMCpv6i3vFZAT68btsTQOMncXXMk1I70hyIZUEHSY/edit?usp=sharing)
- [Indexing on Solana Slides](https://docs.google.com/presentation/d/1L9-0ysJwsv8aAsd9l-g9nr_PIEBcnf9Itrp2YXtCmyA/edit?usp=sharing)
- [Agentic Payments Slides](https://docs.google.com/presentation/d/1z0tCp_ptb_0Ho_hopZL9hJhTIQnWM-UMl1hUJWdizwo/edit?usp=sharing)
- [Security on Solana Slides](https://docs.google.com/presentation/d/141W4WGYF5ZhbLjD_wipM_WMH3vwQgW3Qr5KY-PhR5ho/edit?usp=sharing)
- From EVM to SVM (Module 1B) Slides - PLACEHOLDER (deck not yet created)
