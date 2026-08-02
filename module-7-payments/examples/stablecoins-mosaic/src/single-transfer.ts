/**
 * Single Stablecoin Transfer with Memo
 * =====================================
 *
 * Demonstrates a single stablecoin transfer from one wallet to another
 * using the Mosaic SDK, with a memo attached for reconciliation.
 *
 * This is the simplest payment flow on Solana:
 * 1. Build a transfer transaction with an optional memo
 * 2. Sign the transaction
 * 3. Send and confirm - the transfer settles in ~400ms with a fee under $0.001
 *
 * The memo field is used to attach business context to the payment -
 * invoice IDs, reference numbers, or any string that ties the on-chain
 * transaction to off-chain accounting systems.
 *
 * Usage:
 *   npm run single-transfer
 */

import {
  address,
  generateKeyPairSigner,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import { createTransferTransaction } from "@solana/mosaic-sdk";
import {
  getRpc,
  getRpcSubscriptions,
  loadSigner,
  getMintAddress,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// The amount to transfer (in human-readable decimals, e.g. "100.50" for 100.50 USDC)
const AMOUNT = "10.00";

// Business memo - attach invoice ID, payment reference, or any reconciliation data
const MEMO = "INV-2026-04-001 | Consulting services - April 2026";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Single Stablecoin Transfer with Memo ===\n");

  // 1. Load configuration
  const rpc = getRpc();
  const rpcSubscriptions = getRpcSubscriptions();
  const sender = await loadSigner();
  const mint = getMintAddress();

  // For this demo we generate a throwaway recipient wallet so the example
  // runs out of the box. In a real payment flow, use the recipient's actual
  // wallet address instead:
  //   const recipient = address("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
  const recipient = (await generateKeyPairSigner()).address;

  console.log(`Sender:    ${sender.address}`);
  console.log(`Recipient: ${recipient}`);
  console.log(`Mint:      ${mint}`);
  console.log(`Amount:    ${AMOUNT}`);
  console.log(`Memo:      ${MEMO}`);
  console.log();

  // 2. Build the transfer transaction
  //    Mosaic handles:
  //    - Resolving the sender and recipient ATAs
  //    - Creating the recipient ATA if it doesn't exist
  //    - Converting the decimal amount to raw token units
  //    - Thawing accounts if Token ACL is enabled on the mint
  //    - Appending the memo instruction before the transfer
  console.log("Building transfer transaction...");

  const transaction = await createTransferTransaction({
    rpc,
    mint,
    from: sender.address,
    to: recipient,
    feePayer: sender,
    authority: sender,
    amount: AMOUNT,
    memo: MEMO,
  });

  // 3. Sign the transaction
  //    The sender signs the transaction (as both authority and fee payer).
  console.log("Signing transaction...");

  const signedTransaction = await signTransactionMessageWithSigners(transaction);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const signature = getSignatureFromTransaction(signedTransaction);

  // 4. Send and confirm
  //    The transaction settles in ~400ms on Solana.
  console.log("Sending and confirming transaction...");

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

  console.log(`\nTransfer complete!`);
  console.log(`Signature: ${signature}`);
  console.log(
    `Explorer:  https://explorer.solana.com/tx/${signature}?cluster=devnet`
  );
}

main().catch(console.error);
