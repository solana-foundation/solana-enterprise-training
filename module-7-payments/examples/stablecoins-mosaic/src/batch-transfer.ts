/**
 * Batch Stablecoin Transfers with Memos
 * =======================================
 *
 * Demonstrates how to pack multiple stablecoin transfers into a single
 * transaction using the Mosaic SDK. Each transfer includes a unique memo
 * for reconciliation.
 *
 * Key concepts:
 * - Multiple transfer instructions composed into one transaction
 * - One signature, one base fee, one confirmation for all transfers
 * - Atomic execution: all transfers succeed or all fail (no partial state)
 * - Memos attach business context (invoice IDs, references) to each transfer
 *
 * Transaction size limit:
 *   Solana transactions are capped at ~1,232 bytes. In practice, this allows
 *   4-6 transfers per transaction depending on memo length and whether ATAs
 *   need to be created. For larger batches, split across multiple transactions.
 *
 * Usage:
 *   npm run batch-transfer
 */

import {
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signAndSendTransactionMessageWithSigners,
  type Address,
  type IInstruction,
} from "@solana/kit";
import { createTransferInstructions } from "@solana/mosaic-sdk";
import { getRpc, loadSigner, getMintAddress } from "./helpers.js";

// ---------------------------------------------------------------------------
// Payment batch - define recipients, amounts, and memos
// ---------------------------------------------------------------------------

interface Payment {
  to: Address;
  amount: string;
  memo: string;
}

// Example: a payroll batch or multi-recipient disbursement
const PAYMENTS: Payment[] = [
  {
    to: address("Recipient1WalletAddressHere1111111111111111111"),
    amount: "1500.00",
    memo: "PAYROLL-2026-04 | Employee #1001 - April salary",
  },
  {
    to: address("Recipient2WalletAddressHere1111111111111111111"),
    amount: "2200.00",
    memo: "PAYROLL-2026-04 | Employee #1002 - April salary",
  },
  {
    to: address("Recipient3WalletAddressHere1111111111111111111"),
    amount: "1800.00",
    memo: "PAYROLL-2026-04 | Employee #1003 - April salary",
  },
  {
    to: address("Recipient4WalletAddressHere1111111111111111111"),
    amount: "3100.00",
    memo: "PAYROLL-2026-04 | Employee #1004 - April salary",
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Batch Stablecoin Transfers with Memos ===\n");

  // 1. Load configuration
  const rpc = getRpc();
  const sender = await loadSigner();
  const mint = getMintAddress();

  console.log(`Sender: ${sender.address}`);
  console.log(`Mint:   ${mint}`);
  console.log(`Batch:  ${PAYMENTS.length} payments\n`);

  // 2. Build transfer instructions for each payment
  //    createTransferInstructions() returns the raw instructions without
  //    wrapping them in a transaction. This allows us to compose multiple
  //    sets of instructions into a single transaction.
  console.log("Building transfer instructions...\n");

  const allInstructions: IInstruction[] = [];

  for (const payment of PAYMENTS) {
    console.log(`  -> ${payment.to} | ${payment.amount} | ${payment.memo}`);

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

  console.log(`\nTotal instructions: ${allInstructions.length}`);

  // 3. Compose all instructions into a single transaction
  //    One signature, one base fee, one confirmation.
  //    All transfers are atomic - they either all succeed or all fail.
  console.log("Composing batch transaction...");

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash()
    .send();

  const transaction = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(sender, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(allInstructions, tx)
  );

  // 4. Sign and send the batch transaction
  console.log("Signing and sending batch transaction...");

  const signature = await signAndSendTransactionMessageWithSigners(transaction);

  // 5. Summary
  const totalAmount = PAYMENTS.reduce(
    (sum, p) => sum + parseFloat(p.amount),
    0
  );

  console.log(`\nBatch transfer complete!`);
  console.log(`Payments:   ${PAYMENTS.length}`);
  console.log(`Total:      ${totalAmount.toFixed(2)}`);
  console.log(`Signature:  ${signature}`);
  console.log(
    `Explorer:   https://explorer.solana.com/tx/${signature}?cluster=devnet`
  );
  console.log(`\nAll ${PAYMENTS.length} transfers settled atomically in a single transaction.`);
}

main().catch(console.error);
