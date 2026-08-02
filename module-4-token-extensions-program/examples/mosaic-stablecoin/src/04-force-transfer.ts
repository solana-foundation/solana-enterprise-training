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
 * Because the source account was frozen in step 03, the seizure is
 * composed as one atomic transaction:
 *   1. Thaw the frozen source account (issuer authority via Token ACL)
 *   2. Force-transfer the tokens using the Permanent Delegate
 *   3. Re-freeze the source account
 * The account is never left unfrozen - all three steps land in the
 * same transaction.
 *
 * Usage:
 *   npm run force-transfer
 */

import {
  createForceTransferTransaction,
  getThawInstructions,
  getFreezeInstructions,
  resolveTokenAccount,
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
  const mint = address(MINT_ADDRESS);

  console.log("  Mint        :", MINT_ADDRESS);
  console.log("  From (seize):", FROM_WALLET);
  console.log("  To (recover):", TO_WALLET);
  console.log("  Amount      :", AMOUNT.toLocaleString(), "USDF");
  console.log();
  console.log("  Action: Thaw + force transfer + re-freeze (atomic)");
  console.log();

  // 1. Resolve the frozen source token account
  const { tokenAccount: sourceAta, isFrozen } = await resolveTokenAccount(
    rpc,
    address(FROM_WALLET),
    mint
  );

  // 2. Thaw the source account - Token-2022 blocks transfers from frozen
  //    accounts, even for the Permanent Delegate. Only needed if frozen.
  const thawInstructions = isFrozen
    ? await getThawInstructions({ rpc, authority, tokenAccount: sourceAta })
    : [];

  // 3. Build the force-transfer using the Permanent Delegate authority.
  //    Mosaic resolves ATAs (creating the recovery ATA if needed) and
  //    converts the decimal amount. We reuse its instructions so we can
  //    compose them with the thaw / re-freeze steps.
  const forceTransferTx = await createForceTransferTransaction(
    rpc,
    mint,
    address(FROM_WALLET),     // source wallet
    address(TO_WALLET),       // destination wallet
    AMOUNT,                   // decimal amount
    authority,                // permanent delegate signer
    authority,                // fee payer
  );

  // 4. Re-freeze the source account so the sanctioned wallet stays blocked
  const refreezeInstructions = isFrozen
    ? await getFreezeInstructions({ rpc, authority, tokenAccount: sourceAta })
    : [];

  // 5. Compose everything into one atomic transaction
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(authority, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          ...thawInstructions,
          ...forceTransferTx.instructions,
          ...refreezeInstructions,
        ],
        m
      )
  );

  console.log("  Signing and sending...");
  const signature = await signAndSend(tx);

  console.log(`\n  Force transfer complete`);
  console.log(`  ${AMOUNT.toLocaleString()} USDF seized from ${FROM_WALLET}`);
  console.log(`  and transferred to ${TO_WALLET}`);
  console.log(`  The sanctioned account was re-frozen in the same transaction.`);
  console.log(`  Explorer: ${explorerUrl(signature)}`);
}

main().catch((err) => {
  console.error("\n  Error:", err.message ?? err);
  process.exit(1);
});
