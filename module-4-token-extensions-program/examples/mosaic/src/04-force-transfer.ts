/**
 * 04-force-transfer.ts
 * ────────────────────────────────────────────────────────────────
 * Demonstrates the Permanent Delegate extension: the issuer can
 * forcibly move tokens from any account without the owner's
 * signature.
 *
 * Enterprise use cases:
 *   • Court-ordered asset seizure
 *   • Recovery of tokens from compromised wallets
 *   • Regulatory clawback / forced liquidation
 *
 * Mosaic handles:
 *   • ATA resolution for both source and destination
 *   • sRFC-37 thaw if destination is frozen
 *   • Decimal-to-raw amount conversion
 *
 * Usage:
 *   npm run force-transfer
 */

import { createForceTransferTransaction } from "@solana/mosaic-sdk";
import {
  signTransactionMessageWithSigners,
  compileTransaction,
  getBase64EncodedWireTransaction,
  address,
} from "@solana/kit";
import { getRpc, loadAuthority, heading, explorerUrl } from "./helpers.js";

// ── Configuration ─────────────────────────────────────────────────
const MINT_ADDRESS = process.env.MINT_ADDRESS ?? "";
const FROM_WALLET = process.env.SANCTIONED_WALLET ?? "";   // source (sanctioned user)
const TO_WALLET = process.env.RECOVERY_WALLET ?? "";       // destination (recovery / treasury)
const AMOUNT = 500_000;  // 500,000 USDF to seize

async function main() {
  heading("MOSAIC - Force Transfer (Asset Seizure)");

  if (!MINT_ADDRESS) throw new Error("Set MINT_ADDRESS in .env");
  if (!FROM_WALLET) throw new Error("Set SANCTIONED_WALLET in .env");
  if (!TO_WALLET) throw new Error("Set RECOVERY_WALLET in .env");

  const rpc = getRpc();
  const authority = await loadAuthority();

  console.log("  Mint        :", MINT_ADDRESS);
  console.log("  From (seize):", FROM_WALLET);
  console.log("  To (recover):", TO_WALLET);
  console.log("  Amount      :", AMOUNT.toLocaleString(), "USDF");
  console.log();
  console.log("  Action: Force transfer tokens using Permanent Delegate authority");
  console.log();

  // Build force-transfer transaction
  // The authority acts as the permanent delegate, overriding the owner's approval
  const tx = await createForceTransferTransaction(
    rpc,
    address(MINT_ADDRESS),
    address(FROM_WALLET),     // source wallet
    address(TO_WALLET),       // destination wallet
    AMOUNT,                   // decimal amount
    authority,                // permanent delegate signer
    authority,                // fee payer
  );

  // Sign and send
  console.log("  Signing and sending...");
  const signedTx = await signTransactionMessageWithSigners(tx);
  const wireTransaction = getBase64EncodedWireTransaction(compileTransaction(signedTx));
  const signature = await rpc
    .sendTransaction(wireTransaction, { encoding: "base64" })
    .send();

  console.log(`\n  Force transfer complete`);
  console.log(`  ${AMOUNT.toLocaleString()} USDF seized from ${FROM_WALLET}`);
  console.log(`  and transferred to ${TO_WALLET}`);
  console.log(`  Explorer: ${explorerUrl(signature)}`);
}

main().catch((err) => {
  console.error("\n  Error:", err.message ?? err);
  process.exit(1);
});
