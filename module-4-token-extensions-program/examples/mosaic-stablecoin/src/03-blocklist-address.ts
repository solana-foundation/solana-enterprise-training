/**
 * 03-blocklist-address.ts
 * ────────────────────────────────────────────────────────────────
 * Demonstrates adding a wallet to the on-chain blocklist and
 * freezing their token account in a single atomic transaction.
 *
 * This is the core compliance primitive: when a wallet is
 * flagged (e.g. OFAC sanctions), the issuer can immediately
 * block it on-chain so no further transfers are possible.
 *
 * Mosaic + sRFC-37 handles:
 *   • Adding the wallet to the ABL blocklist program
 *   • Freezing the associated token account via Token ACL
 *
 * Usage:
 *   npm run blocklist
 */

import { createAddToBlocklistTransaction } from "@solana/mosaic-sdk";
	@@ -30,7 +38,7 @@ const MINT_ADDRESS = process.env.MINT_ADDRESS ?? "";
const SANCTIONED_WALLET = process.env.SANCTIONED_WALLET ?? "";

async function main() {
  heading("MOSAIC - Blocklist a Wallet (Sanctions Compliance)");

  if (!MINT_ADDRESS) throw new Error("Set MINT_ADDRESS in .env");
  if (!SANCTIONED_WALLET) throw new Error("Set SANCTIONED_WALLET in .env");
	@@ -41,12 +49,12 @@ async function main() {
  console.log("  Mint             :", MINT_ADDRESS);
  console.log("  Sanctioned wallet:", SANCTIONED_WALLET);
  console.log();
  console.log("  Action: Add to blocklist + freeze token account");
  console.log();

  // Build the blocklist transaction
  // Mosaic atomically:
  //   1. Adds the wallet to the ABL blocklist
  //   2. Freezes their token account via Token ACL
  const tx = await createAddToBlocklistTransaction(
    rpc,
	@@ -63,11 +71,11 @@ async function main() {
    .sendTransaction(wireTransaction, { encoding: "base64" })
    .send();

  console.log(`\n  Wallet blocklisted and frozen`);
  console.log(`  ${SANCTIONED_WALLET} can no longer send or receive USDF.`);
  console.log(`  Explorer: ${explorerUrl(signature)}`);
  console.log();
  console.log("  To remove from the blocklist later, use createRemoveFromBlocklistTransaction()");
}

main().catch((err) => {
  console.error("\n  Error:", err.message ?? err);
  process.exit(1);
});