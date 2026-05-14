/**
 * helpers.ts - Shared utilities for the Mosaic stablecoin demo.
 *
 * Handles RPC connection setup, keypair loading, and transaction
 * signing / sending so the individual scripts stay focused on
 * the Mosaic SDK calls themselves.
 */

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
  signAndSendTransactionMessageWithSigners,
  type Rpc,
  type SolanaRpcApi,
  type KeyPairSigner,
  type RpcSubscriptions,
  type SolanaRpcSubscriptionsApi,
  getSignatureFromTransaction,
  compileTransaction,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type { FullTransaction } from "@solana/mosaic-sdk";
import "dotenv/config";

// ---------------------------------------------------------------------------
// RPC connection
// ---------------------------------------------------------------------------

export function getRpc(): Rpc<SolanaRpcApi> {
  const url = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  return createSolanaRpc(url);
}

export function getRpcSubscriptions(): RpcSubscriptions<SolanaRpcSubscriptionsApi> {
  const httpUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const wsUrl = httpUrl.replace("https://", "wss://").replace("http://", "ws://");
  return createSolanaRpcSubscriptions(wsUrl);
}

// ---------------------------------------------------------------------------
// Keypair loading
// ---------------------------------------------------------------------------

/**
 * Loads the authority keypair from the AUTHORITY_PRIVATE_KEY env var.
 * Expects a JSON array of bytes, e.g. [12,34,56,...] (64 bytes).
 */
export async function loadAuthority(): Promise<KeyPairSigner> {
  const raw = process.env.AUTHORITY_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      "AUTHORITY_PRIVATE_KEY is not set. Copy .env.example to .env and configure it."
    );
  }

  // Support both JSON array format [1,2,3,...] and comma-separated format
  const cleaned = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  const bytes = new Uint8Array(cleaned.split(",").map((s) => Number(s.trim())));

  if (bytes.length !== 64) {
    throw new Error(
      `Expected 64-byte secret key, got ${bytes.length} bytes. ` +
        "Use the full keypair (secret + public key)."
    );
  }

  return createKeyPairSignerFromBytes(bytes);
}

/**
 * Generates a fresh keypair signer (e.g. for a new mint account).
 */
export async function newKeypair(): Promise<KeyPairSigner> {
  return generateKeyPairSigner();
}

// ---------------------------------------------------------------------------
// Transaction helpers
// ---------------------------------------------------------------------------

/**
 * Signs and sends a FullTransaction built by the Mosaic SDK, then
 * confirms the transaction and returns the signature string.
 */
export async function signAndSend(
  tx: FullTransaction,
  signers: KeyPairSigner[]
): Promise<string> {
  const rpc = getRpc();
  const rpcSubs = getRpcSubscriptions();

  // Sign and send using Solana Kit's built-in helper
  const signedTx = await signTransactionMessageWithSigners(tx);
  const signature = getSignatureFromTransaction(compileTransaction(signedTx));

  await rpc
    .sendTransaction(
      // @ts-ignore - encoding accepted at runtime
      Buffer.from(
        new Uint8Array(
          (() => {
            const codec = (await import("@solana/kit")).getTransactionCodec();
            return codec.encode(compileTransaction(signedTx));
          })()
        )
      ).toString("base64"),
      { encoding: "base64" }
    )
    .send();

  // Wait for confirmation
  console.log(`  Confirming transaction...`);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Poll for confirmation
  let confirmed = false;
  for (let i = 0; i < 30; i++) {
    const status = await rpc
      .getSignatureStatuses([signature])
      .send();
    if (status.value[0]?.confirmationStatus === "confirmed" ||
        status.value[0]?.confirmationStatus === "finalized") {
      confirmed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!confirmed) {
    console.warn("  Transaction may not have confirmed in time.");
  }

  return signature;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function explorerUrl(signature: string, cluster = "devnet"): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function mintExplorerUrl(mint: string, cluster = "devnet"): string {
  return `https://explorer.solana.com/address/${mint}?cluster=${cluster}`;
}

export function heading(title: string) {
  const line = "═".repeat(title.length + 4);
  console.log(`\n╔${line}╗`);
  console.log(`║  ${title}  ║`);
  console.log(`╚${line}╝\n`);
}
