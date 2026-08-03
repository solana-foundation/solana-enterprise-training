/**
 * Shared helpers for loading configuration and creating signers.
 */

import "dotenv/config";
import {
  type Address,
  type KeyPairSigner,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getBase58Encoder,
  address,
} from "@solana/kit";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing environment variable: ${key}. Copy .env.example to .env and fill in the values.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

export function getRpc() {
  const rpcUrl = getEnvOrThrow("RPC_URL");
  return createSolanaRpc(rpcUrl);
}

// Websocket client used to confirm transactions. Defaults to the RPC URL with
// the protocol switched to ws(s); override with RPC_WS_URL if your provider
// uses a different websocket endpoint.
export function getRpcSubscriptions() {
  const wsUrl =
    process.env.RPC_WS_URL ??
    getEnvOrThrow("RPC_URL").replace(/^http/, "ws");
  return createSolanaRpcSubscriptions(wsUrl);
}

// ---------------------------------------------------------------------------
// Signer from base58 private key
// ---------------------------------------------------------------------------

export async function loadSigner(): Promise<KeyPairSigner<string>> {
  const raw = getEnvOrThrow("SENDER_PRIVATE_KEY");
  // A base58 *encoder* converts a base58 string into bytes.
  const bytes = getBase58Encoder().encode(raw);
  return createKeyPairSignerFromBytes(bytes);
}

// ---------------------------------------------------------------------------
// Mint address
// ---------------------------------------------------------------------------

export function getMintAddress(): Address {
  return address(getEnvOrThrow("MINT_ADDRESS"));
}
