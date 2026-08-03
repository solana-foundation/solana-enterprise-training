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
 * Two instructions, one transaction:
 *   • Add the wallet to the ABL blocklist
 *   • Freeze the wallet's token account via Token ACL
 *     (the mint's freeze authority is held by the Token ACL
 *     config PDA, so freezing goes through the Token ACL program)
 *
 * Usage:
 *   npm run blocklist
 */

import {
  getListConfigPda,
  getAddWalletInstructions,
  getFreezeWalletInstructions,
} from "@solana/mosaic-sdk";
import {
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
} from "@solana/kit";
import { getRpc, loadAuthority, signAndSend, heading, explorerUrl } from "./helpers.js";

// ── Configuration ─────────────────────────────────────────────────
const MINT_ADDRESS = process.env.MINT_ADDRESS ?? "";
const SANCTIONED_WALLET = process.env.SANCTIONED_WALLET ?? "";

async function main() {
  heading("MOSAIC - Blocklist a Wallet (Sanctions Compliance)");

  if (!MINT_ADDRESS) throw new Error("Set MINT_ADDRESS in .env");
  if (!SANCTIONED_WALLET) throw new Error("Set SANCTIONED_WALLET in .env");

  const rpc = getRpc();
  const authority = await loadAuthority();
  const mint = address(MINT_ADDRESS);
  const sanctioned = address(SANCTIONED_WALLET);

  console.log("  Mint             :", MINT_ADDRESS);
  console.log("  Sanctioned wallet:", SANCTIONED_WALLET);
  console.log();
  console.log("  Action: Add to blocklist + freeze token account");
  console.log();

  // 1. Add the wallet to the ABL blocklist created in 01.
  //    The list config PDA is derived from the list authority and the mint.
  const listConfig = await getListConfigPda({
    authority: authority.address,
    mint,
  });

  const addToBlocklistInstructions = await getAddWalletInstructions({
    authority,
    list: listConfig,
    wallet: sanctioned,
  });

  // 2. Freeze the wallet's token account. Mosaic detects that the mint's
  //    freeze authority is held by the Token ACL program and routes the
  //    freeze through it (our authority is the Token ACL config authority).
  const freezeInstructions = await getFreezeWalletInstructions({
    rpc,
    payer: authority,
    authority,
    wallet: sanctioned,
    mint,
  });

  // 3. Compose both into a single atomic transaction: the wallet is
  //    blocklisted and frozen in the same slot, with no gap in between.
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(authority, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [...addToBlocklistInstructions, ...freezeInstructions],
        m
      )
  );

  console.log("  Signing and sending...");
  const signature = await signAndSend(tx);

  console.log(`\n  Wallet blocklisted and frozen`);
  console.log(`  ${SANCTIONED_WALLET} can no longer send or receive USDF.`);
  console.log(`  Explorer: ${explorerUrl(signature)}`);
  console.log();
  console.log("  To remove from the blocklist later, use getRemoveWalletInstructions()");
}

main().catch((err) => {
  console.error("\n  Error:", err.message ?? err);
  process.exit(1);
});
