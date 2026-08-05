// Shared configuration for the x402 devnet example.
// Lab step 2 ("different SPL token and price") is done here: point TOKEN_MINT
// at any devnet mint you control and adjust PRICE_BASE_UNITS / TOKEN_DECIMALS.

import { PublicKey } from "@solana/web3.js";

export const RPC_URL = "https://api.devnet.solana.com";

// Devnet USDC (circulated by the faucet at https://faucet.circle.com).
// Swap this for your own devnet mint to complete lab step 2.
export const TOKEN_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
export const TOKEN_DECIMALS = 6;

// Price per request, in base units (100 = 0.0001 USDC at 6 decimals).
export const PRICE_BASE_UNITS = 100;

export const SERVER_PORT = 3001;

// JWT session settings (lab step 3): one verified payment grants
// SESSION_TTL_SECONDS of access without further payments.
export const SESSION_TTL_SECONDS = 5 * 60;
// Demonstration only - in production, read the secret from the environment.
export const JWT_SECRET = process.env.JWT_SECRET ?? "x402-lab-secret-change-me";

// x402 constants
export const X402_VERSION = 1;
export const SCHEME = "exact";
export const NETWORK = "solana-devnet";
