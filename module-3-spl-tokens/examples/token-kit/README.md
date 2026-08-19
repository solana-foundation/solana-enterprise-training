# Token Kit - Mint SPL Tokens with @solana/kit

A minimal client-side example: create a token mint and mint tokens to an
Associated Token Account (ATA) using [@solana/kit](https://github.com/anza-xyz/kit)
and the generated `@solana-program/token` client. No Anchor, no custom
program - just the standard SPL Token Program driven from TypeScript.

## What it does

One script, one transaction, four instructions:

1. **Create the mint account** - the System Program allocates 82 bytes and
   assigns them to the Token Program.
2. **Initialize the mint** - sets decimals (6) and the mint / freeze
   authorities.
3. **Create the ATA** - the canonical token account for the
   (owner, mint) pair, derived rather than chosen.
4. **Mint 1,000 tokens** - signed by the mint authority.

Because all four ride in a single transaction, the launch is atomic:
either the token exists fully set up, or nothing happened.

The script then reads the mint and token account back from the chain to
verify supply and balance.

## Run it

```bash
npm install
npm run mint-tokens
```

Defaults to devnet with a fresh airdropped keypair. Point it elsewhere with:

```bash
RPC_URL=http://127.0.0.1:8899 npm run mint-tokens   # local validator
```

## EVM comparison

| EVM (ERC-20) | Solana (SPL Token) |
|---|---|
| Deploy a token contract per token | Reuse the single deployed Token Program; a token is just a **mint account** |
| Balances live in the contract's storage mapping | Each holder has their own **token account** (ATA) |
| `decimals()` is a contract function | Decimals are a field in the mint account's data |
| Minting logic is whatever the contract implements | `MintTo` instruction, gated by the **mint authority** |
