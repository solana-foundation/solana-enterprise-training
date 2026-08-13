# Solana Enterprise Training Course

A comprehensive, instructor-led training program designed for enterprise teams building on Solana. Covers the foundational concepts, development tools, and token infrastructure required to ship production-grade applications on the Solana network.

## Course Overview

This training program is structured into several modules that progressively build expertise from platform fundamentals through to advanced token functionality and enterprise use cases. Each module includes presentation slides, hands-on exercises, code examples, and challenges to reinforce learning.

## Modules

| # | Module | Description |
|---|--------|-------------|
| 1 | [Solana Overview](module-1-solana-overview/) | Platform architecture, accounts, transactions, and the Solana data model |
| 1B | [From EVM to SVM](module-1b-from-evm-to-svm/) | Account model translation, ERC-20 vs SPL, CPI vs call, reentrancy, transactions, and tooling for EVM-native teams |
| 2 | [Rust Concepts & Anchor](module-2-rust-concepts-and-anchor/) | Rust fundamentals for Solana and the Anchor framework |
| 3 | [SPL Tokens](module-3-spl-tokens/) | Token Program, mint and token accounts, metadata, and minting tokens |
| 4 | [Token Extensions Program](module-4-token-extensions-program/) | Token-2022 extensions, Token ACL, and enterprise compliance features |
| 5 | [RWAs on Solana](module-5-rwas-on-solana/) | Real world asset tokenization, compliance infrastructure, and DeFi composability |
| 6 | [DeFi on Solana](module-6-defi-on-solana/) | DeFi primitives, major protocols, and enterprise applications |
| 7 | [Payments](module-7-payments/) | Enterprise payment infrastructure, batch transfers, and cross-border settlement |
| 8 | [Privacy on Solana](module-8-privacy-on-solana/) | Confidential Transfers, Contra payment channels, and Solana Permissioned Environments |
| 9 | [Indexing on Solana](module-9-indexing-on-solana/) | Geyser, Yellowstone gRPC, indexing frameworks, storage strategies, and real-time streaming |
| 10 | [Agentic Payments](module-10-agentic-payments/) | Machine-to-machine micropayments with the x402 protocol, facilitators, and the agent commerce ecosystem |

## Prerequisites

Understanding of general programming concepts and basic familiarity with blockchain technology. Prior experience with Rust or Solana is not required.

## Course Documents

- [Course Plan](course-plan.md) - Full curriculum outline, schedule, and learning objectives
- [Teaching Resources](teaching-resources.md) - Curated references, tools, and supplementary materials for instructors

## Getting Started

1. Review the [Course Plan](course-plan.md) for an overview of the full curriculum
2. Work through the modules in order, starting with [Module 1: Solana Overview](module-1-solana-overview/)
3. Complete the hands-on exercises and challenges in each module before proceeding to the next

## Repository Structure

```
enterprise-training/
├── README.md
├── course-plan.md
├── teaching-resources.md
├── module-1-solana-overview/
│   ├── README.md
│   ├── examples/
│   └── challenge/
├── module-1b-from-evm-to-svm/
│   └── README.md
├── module-2-rust-concepts-and-anchor/
│   ├── README.md
│   ├── examples/
│   └── challenge/
├── module-3-spl-tokens/
│   ├── README.md
│   ├── examples/
│   └── challenge/
├── module-4-token-extensions-program/
│   ├── README.md
│   ├── examples/
│   └── challenge/
├── module-5-rwas-on-solana/
│   ├── README.md
│   ├── examples/
│   └── challenge/
├── module-6-defi-on-solana/
│   ├── README.md
│   ├── examples/
│   └── challenge/
├── module-7-payments/
│   ├── README.md
│   ├── examples/
│   └── challenge/
├── module-8-privacy-on-solana/
│   ├── README.md
│   ├── examples/
│   └── challenge/
├── module-9-indexing-on-solana/
│   ├── README.md
│   ├── examples/
│   └── challenge/
└── module-10-agentic-payments/
    ├── README.md
    ├── Agentic Payments - Slides.pptx
    └── examples/
```
