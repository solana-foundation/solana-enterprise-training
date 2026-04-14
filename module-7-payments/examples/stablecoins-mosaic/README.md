# Stablecoin Payments with Mosaic

This example demonstrates enterprise stablecoin payment flows on Solana using the [Mosaic SDK](https://github.com/solana-foundation/mosaic) from the Solana Foundation.

---

## What is Mosaic?

Mosaic is a TypeScript SDK that abstracts the complexity of Token-2022 (Token Extensions Program) operations on Solana. It provides ready-to-use functions for creating and managing compliant tokens - stablecoins, RWAs, and more - with built-in support for compliance features like Token ACL, confidential balances, and transfer hooks.

For payments, Mosaic handles the details that would otherwise require significant boilerplate: ATA resolution and creation, decimal-to-raw amount conversion, account thawing for Token ACL-enabled mints, and memo attachment.

---

## Examples

### 1. Single Transfer with Memo (`src/single-transfer.ts`)

The simplest payment flow: transfer stablecoins from one wallet to another with a business memo attached for reconciliation.

```
npm run single-transfer
```

**What it demonstrates:**
- Building a transfer transaction with `createTransferTransaction()`
- Attaching a memo (invoice ID, payment reference) to the payment
- Signing and sending with a single function call
- Mosaic automatically resolves ATAs, creates them if needed, and handles Token ACL thawing

**Key code:**

```typescript
const transaction = await createTransferTransaction({
  rpc,
  mint,
  from: sender.address,
  to: recipientAddress,
  feePayer: sender,
  authority: sender,
  amount: "100.50",
  memo: "INV-2026-04-001 | Consulting services",
});

const signature = await signAndSendTransactionMessageWithSigners(transaction);
```

The `amount` field accepts human-readable decimals (e.g. `"100.50"` for 100.50 USDC). Mosaic converts this to raw token units based on the mint's decimal configuration.

The `memo` field is optional. When provided, Mosaic prepends a memo instruction (via Solana's Memo Program) before the transfer. This memo is stored in the transaction logs and is queryable via RPC - making it ideal for tying on-chain payments to off-chain accounting systems.

---

### 2. Batch Transfers with Memos (`src/batch-transfer.ts`)

Pack multiple transfers into a single atomic transaction - one signature, one fee, one confirmation.

```
npm run batch-transfer
```

**What it demonstrates:**
- Using `createTransferInstructions()` to get raw instructions (instead of a full transaction)
- Composing multiple sets of instructions into a single transaction
- Atomic execution: all transfers succeed or all fail
- Each transfer carries its own unique memo for individual reconciliation

**Key code:**

```typescript
// Build instructions for each payment
const allInstructions = [];

for (const payment of payments) {
  const instructions = await createTransferInstructions({
    rpc,
    mint,
    from: sender.address,
    to: payment.to,
    feePayer: sender,
    authority: sender,
    amount: payment.amount,
    memo: payment.memo,
  });
  allInstructions.push(...instructions);
}

// Compose into a single transaction
const transaction = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(sender, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions(allInstructions, tx)
);

const signature = await signAndSendTransactionMessageWithSigners(transaction);
```

The difference between `createTransferTransaction()` and `createTransferInstructions()`:

- `createTransferTransaction()` returns a complete, ready-to-sign transaction. Use it for single transfers.
- `createTransferInstructions()` returns just the instructions. Use it when you need to compose multiple operations into one transaction.

**Transaction size limit:** Solana transactions are capped at ~1,232 bytes. In practice, this allows 4-6 transfers per transaction depending on memo length and whether ATAs need to be created. For larger batches, split across multiple transactions.

---

## Setup

### Prerequisites

- Node.js 18+
- A Solana devnet wallet with SOL for fees
- A Token-2022 stablecoin mint deployed on devnet

### Installation

```bash
npm install
```

### Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with:

- `RPC_URL` - Your Solana RPC endpoint (e.g. `https://api.devnet.solana.com`)
- `SENDER_PRIVATE_KEY` - Base58-encoded private key of the sender wallet
- `MINT_ADDRESS` - Address of your Token-2022 stablecoin mint

### Running

```bash
# Single transfer with memo
npm run single-transfer

# Batch transfer with memos
npm run batch-transfer
```

---

## Key Concepts

### Fee Payer Abstraction

In both examples, the sender is also the fee payer. In a production enterprise setup, the fee payer can be a separate platform wallet - the end user never needs to hold SOL. This is configured by passing a different signer to the `feePayer` parameter.

### Memos for Reconciliation

The memo field maps directly to traditional payment references. Common patterns:

- Invoice references: `"INV-2026-04-001"`
- Payroll identifiers: `"PAYROLL-2026-04 | Employee #1001"`
- Structured data: `"INV-2026-04-001|1713052800|DEPT-FINANCE"`

Memos are stored in the transaction logs and can be queried via RPC for reconciliation.

### Atomicity

All instructions in a Solana transaction execute atomically. In a batch transfer, every payment either succeeds or the entire transaction rolls back. There is no partial execution - you will never end up in a state where some recipients got paid and others did not.

---

## Project Structure

```
stablecoins-mosaic/
├── src/
│   ├── helpers.ts          # Shared config: RPC, signer, mint loading
│   ├── single-transfer.ts  # Single transfer with memo
│   └── batch-transfer.ts   # Batch transfers with memos
├── package.json
├── tsconfig.json
```

## Additional Resources

- [Mosaic SDK Repository](https://github.com/solana-foundation/mosaic)
- [Token-2022 Documentation](https://solana.com/docs/tokens/extensions)
- [Solana Memo Program](https://spl.solana.com/memo)
