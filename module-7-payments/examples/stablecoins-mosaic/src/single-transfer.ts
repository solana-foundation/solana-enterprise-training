/**
 * Single Stablecoin Transfer with Memo
 * =====================================
 *
 * Demonstrates a single stablecoin transfer from one wallet to another
 * using the Mosaic SDK, with a memo attached for reconciliation.
 *
 * This is the simplest payment flow on Solana:
 * 1. Build a transfer transaction with an optional memo
 * 2. Sign and send the transaction
 * 3. The transfer settles in ~400ms with a fee under $0.001
 *
 * The memo field is used to attach business context to the payment -
 * invoice IDs, reference numbers, or any string that ties the on-chain
 * transaction to off-chain accounting systems.
 *
 * Usage:
 *   npm run single-transfer
 */

import { address, signAndSendTransactionMessageWithSigners } from "@solana/kit";
import { createTransferTransaction } from "@solana/mosaic-sdk";
import { getRpc, loadSigner, getMintAddress } from "./helpers.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// The recipient wallet address (replace with an actual address)
const RECIPIENT = address("RecipientWalletAddressHere11111111111111111111");

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
  const sender = await loadSigner();
  const mint = getMintAddress();

  console.log(`Sender:    ${sender.address}`);
  console.log(`Recipient: ${RECIPIENT}`);
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
    to: RECIPIENT,
    feePayer: sender,
    authority: sender,
    amount: AMOUNT,
    memo: MEMO,
  });

  // 3. Sign and send the transaction
  //    The sender signs the transaction (as both authority and fee payer).
  //    The transaction settles in ~400ms on Solana.
  console.log("Signing and sending transaction...");

  const signature = await signAndSendTransactionMessageWithSigners(transaction);

  console.log(`\nTransfer complete!`);
  console.log(`Signature: ${signature}`);
  console.log(
    `Explorer:  https://explorer.solana.com/tx/${signature}?cluster=devnet`
  );
}

main().catch(console.error);
