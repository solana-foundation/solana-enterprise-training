/**
 * 05-pause-token.ts
 * ────────────────────────────────────────────────────────────────
 * Demonstrates the Pausable extension: the issuer can immediately
 * halt ALL transfers of the token - a critical circuit-breaker
 * for emergencies.
 *
 * Enterprise use cases:
 *   • Security incident response (exploit detected)
 *   • Regulatory hold pending investigation
 *   • Coordinated system maintenance
 *
 * Usage:
 *   npm run pause-token
 */

import { createPauseTransaction, createResumeTransaction } from "@solana/mosaic-sdk";
import {
  signTransactionMessageWithSigners,
  compileTransaction,
  getBase64EncodedWireTransaction,
  address,
} from "@solana/kit";
import { getRpc, loadAuthority, heading, explorerUrl } from "./helpers.js";

const MINT_ADDRESS = process.env.MINT_ADDRESS ?? "";
const ACTION = process.argv[2] ?? "pause";  // "pause" or "resume"

async function main() {
  const isPause = ACTION === "pause";
  heading(`MOSAIC - ${isPause ? "Pause" : "Resume"} Token (Emergency Circuit Breaker)`);

  if (!MINT_ADDRESS) throw new Error("Set MINT_ADDRESS in .env");

  const rpc = getRpc();
  const authority = await loadAuthority();

  console.log("  Mint   :", MINT_ADDRESS);
  console.log("  Action :", isPause ? "PAUSE all transfers" : "RESUME transfers");
  console.log();

  const options = {
    mint: address(MINT_ADDRESS),
    pauseAuthority: authority,
    feePayer: authority,
  };

  let tx;
  if (isPause) {
    const result = await createPauseTransaction(rpc, options);
    tx = result.transactionMessage;
    console.log("  Current state: active (not paused)");
    console.log("  Pausing all token operations...");
  } else {
    const result = await createResumeTransaction(rpc, options);
    tx = result.transactionMessage;
    console.log("  Current state: paused");
    console.log("  Resuming token operations...");
  }

  // Sign and send
  console.log();
  console.log("  Signing and sending...");
  const signedTx = await signTransactionMessageWithSigners(tx);
  const wireTransaction = getBase64EncodedWireTransaction(compileTransaction(signedTx));
  const signature = await rpc
    .sendTransaction(wireTransaction, { encoding: "base64" })
    .send();

  console.log(`\n  Token ${isPause ? "PAUSED" : "RESUMED"}`);
  if (isPause) {
    console.log("  All transfers, minting, and burning are now blocked.");
    console.log("  Run with 'resume' argument to re-enable: npx tsx src/05-pause-token.ts resume");
  } else {
    console.log("  Normal token operations have been restored.");
  }
  console.log(`  Explorer: ${explorerUrl(signature)}`);
}

main().catch((err) => {
  console.error("\n  Error:", err.message ?? err);
  process.exit(1);
});
