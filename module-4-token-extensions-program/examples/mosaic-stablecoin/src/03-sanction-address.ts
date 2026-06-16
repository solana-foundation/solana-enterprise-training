/**
 * 03-sanction-address.ts
 * ────────────────────────────────────────────────────────────────
 * Demonstrates adding a wallet to the on-chain sanctions deny list
 * and freezing their token account in a single atomic transaction.
 *
 * This is the core compliance primitive: when a wallet is
 * flagged (e.g. OFAC sanctions), the issuer can immediately
 * block it on-chain so no further transfers are possible.
 *
 * Naming note: the Mosaic SDK calls this mode "Blocklist"
 * (createAddToBlocklistTransaction etc.) - those identifiers are the
 * SDK's API surface and are kept as-is. This demo runs sRFC-37 in
 * deny-list mode (accounts start active, bad actors are frozen).
 * Module 5's anchor-mmf example shows the inverse, an allowlist
 * (accounts start frozen, approved holders are thawed), which is
 * what regulated issuers typically prefer.
 *
 * Mosaic + sRFC-37 handles:
 *   • Adding the wallet to the ABL deny-list program
 *   • Freezing the associated token account via Token ACL
 *
 * Usage:
 *   npm run sanction
 */

import { createAddToBlocklistTransaction } from "@solana/mosaic-sdk";
import {
  signTransactionMessageWithSigners,
  compileTransaction,
  getBase64EncodedWireTransaction,
  address,
} from "@solana/kit";
import { getRpc, loadAuthority, heading, explorerUrl } from "./helpers.js";

// ── Configuration ─────────────────────────────────────────────────
const MINT_ADDRESS = process.env.MINT_ADDRESS ?? "";
const SANCTIONED_WALLET = process.env.SANCTIONED_WALLET ?? "";

async function main() {
  heading("MOSAIC - Sanction a Wallet (Deny-List + Freeze)");

  if (!MINT_ADDRESS) throw new Error("Set MINT_ADDRESS in .env");
  if (!SANCTIONED_WALLET) throw new Error("Set SANCTIONED_WALLET in .env");

  const rpc = getRpc();
  const authority = await loadAuthority();

  console.log("  Mint             :", MINT_ADDRESS);
  console.log("  Sanctioned wallet:", SANCTIONED_WALLET);
  console.log();
  console.log("  Action: Add to deny list + freeze token account");
  console.log();

  // Build the deny-list transaction
  // Mosaic atomically:
  //   1. Adds the wallet to the ABL deny list
  //   2. Freezes their token account via Token ACL
  const tx = await createAddToBlocklistTransaction(
    rpc,
    address(MINT_ADDRESS),
    address(SANCTIONED_WALLET),
    authority,   // freeze authority / list authority
  );

  // Sign and send
  console.log("  Signing and sending...");
  const signedTx = await signTransactionMessageWithSigners(tx);
  const wireTransaction = getBase64EncodedWireTransaction(compileTransaction(signedTx));
  const signature = await rpc
    .sendTransaction(wireTransaction, { encoding: "base64" })
    .send();

  console.log(`\n  Wallet sanctioned and frozen`);
  console.log(`  ${SANCTIONED_WALLET} can no longer send or receive USDF.`);
  console.log(`  Explorer: ${explorerUrl(signature)}`);
  console.log();
  console.log("  To remove from the deny list later, use createRemoveFromBlocklistTransaction()");
}

main().catch((err) => {
  console.error("\n  Error:", err.message ?? err);
  process.exit(1);
});
