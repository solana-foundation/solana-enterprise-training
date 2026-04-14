/**
 * 02-mint-tokens.ts
 * ────────────────────────────────────────────────────────────────
 * Mints tokens to a recipient address. Mosaic handles:
 *   • Associated Token Account (ATA) creation if needed
 *   • Automatic thaw via sRFC-37 if the ATA starts frozen
 *   • Decimal-to-raw amount conversion
 *
 * Usage:
 *   npm run mint-tokens
 */

import { createMintToTransaction } from "@solana/mosaic-sdk";
import {
  signTransactionMessageWithSigners,
  compileTransaction,
  getBase64EncodedWireTransaction,
  address,
} from "@solana/kit";
import { getRpc, loadAuthority, heading, explorerUrl } from "./helpers.js";

// ── Configuration ─────────────────────────────────────────────────
const MINT_ADDRESS = process.env.MINT_ADDRESS ?? "";
const RECIPIENT = process.env.RECIPIENT_ADDRESS ?? "";  // wallet to receive tokens
const AMOUNT = 1_000_000;  // 1,000,000 USDF (6 decimals → 1,000,000.000000)

async function main() {
  heading("MOSAIC - Mint Tokens");

  if (!MINT_ADDRESS) throw new Error("Set MINT_ADDRESS in .env");
  if (!RECIPIENT) throw new Error("Set RECIPIENT_ADDRESS in .env (wallet to receive tokens)");

  const rpc = getRpc();
  const authority = await loadAuthority();

  console.log("  Mint      :", MINT_ADDRESS);
  console.log("  Recipient :", RECIPIENT);
  console.log("  Amount    :", AMOUNT.toLocaleString(), "USDF");
  console.log();

  // Build the mint-to transaction
  // Mosaic will create the ATA if it doesn't exist and handle sRFC-37 thaw
  const tx = await createMintToTransaction(
    rpc,
    address(MINT_ADDRESS),
    address(RECIPIENT),
    AMOUNT,       // decimal amount - SDK converts using mint's decimals
    authority,    // mintAuthority
    authority,    // feePayer
  );

  // Sign and send
  console.log("  Signing and sending...");
  const signedTx = await signTransactionMessageWithSigners(tx);
  const wireTransaction = getBase64EncodedWireTransaction(compileTransaction(signedTx));
  const signature = await rpc
    .sendTransaction(wireTransaction, { encoding: "base64" })
    .send();

  console.log(`\n  Minted ${AMOUNT.toLocaleString()} USDF to ${RECIPIENT}`);
  console.log(`  Explorer: ${explorerUrl(signature)}`);
}

main().catch((err) => {
  console.error("\n  Error:", err.message ?? err);
  process.exit(1);
});
