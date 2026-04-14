/**
 * Shared helpers for loading configuration and creating signers.
 */

import "dotenv/config";
import {
  type Address,
  type KeyPairSigner,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  address,
} from "@solana/kit";
import { getBase58Decoder } from "@solana/codecs";

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

// ---------------------------------------------------------------------------
// Signer from base58 private key
// ---------------------------------------------------------------------------

export async function loadSigner(): Promise<KeyPairSigner<string>> {
  const raw = getEnvOrThrow("SENDER_PRIVATE_KEY");
  const bytes = getBase58Decoder().decode(raw);
  return createKeyPairSignerFromBytes(bytes as unknown as CryptoKey & Uint8Array);
}

// ---------------------------------------------------------------------------
// Mint address
// ---------------------------------------------------------------------------

export function getMintAddress(): Address {
  return address(getEnvOrThrow("MINT_ADDRESS"));
}
