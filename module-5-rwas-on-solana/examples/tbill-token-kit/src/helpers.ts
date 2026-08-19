/**
 * helpers.ts - Shared plumbing for the tokenized T-bill demo.
 *
 * Handles RPC setup, the issuer keypair, transaction send/confirm and a
 * small JSON state file (.state.json) that carries the mint and wallet
 * addresses from one script to the next, so each lifecycle step can run
 * as its own command.
 */

import {
  airdropFactory,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { webcrypto } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants shared by every script
// ---------------------------------------------------------------------------

export const DECIMALS = 6;

// ---------------------------------------------------------------------------
// RPC connection (defaults to devnet; RPC_URL overrides)
// ---------------------------------------------------------------------------

const httpUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
// A local test validator serves websockets on port 8900.
const wsUrl = httpUrl
  .replace("https://", "wss://")
  .replace("http://", "ws://")
  .replace(":8899", ":8900");

export const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(httpUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

export const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const airdrop = airdropFactory({ rpc, rpcSubscriptions });

// ---------------------------------------------------------------------------
// State file: carries addresses between the numbered scripts
// ---------------------------------------------------------------------------

const STATE_PATH = new URL("../.state.json", import.meta.url);

export type DemoState = {
  issuerPrivateKeyHex?: string;
  mint?: string;
  investor?: string;
  investorAta?: string;
  treasuryAta?: string;
};

export function readState(): DemoState {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

export function writeState(patch: DemoState): DemoState {
  const next = { ...readState(), ...patch };
  writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function requireState<K extends keyof DemoState>(key: K): NonNullable<DemoState[K]> {
  const value = readState()[key];
  if (!value) {
    throw new Error(`Missing '${key}' in .state.json - run the earlier scripts first.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Issuer keypair: created once, persisted so every script uses the same one.
// (Plain-text key in a JSON file is for this demo only - NOTE: NEVER do this
// with a real issuer key; use an HSM or MPC signer in production.)
// ---------------------------------------------------------------------------

export async function loadIssuer(): Promise<KeyPairSigner> {
  const state = readState();
  if (state.issuerPrivateKeyHex) {
    const bytes = Uint8Array.from(Buffer.from(state.issuerPrivateKeyHex, "hex"));
    return createKeyPairSignerFromPrivateKeyBytes(bytes);
  }
  const bytes = webcrypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(bytes);
  writeState({ issuerPrivateKeyHex: Buffer.from(bytes).toString("hex") });
  return signer;
}

/** Airdrops SOL to the issuer if the balance is running low. */
export async function ensureFunded(address: Address): Promise<void> {
  const { value: balance } = await rpc.getBalance(address).send();
  if (balance < 100_000_000n) {
    console.log("Requesting airdrop...");
    await airdrop({
      recipientAddress: address,
      lamports: lamports(1_000_000_000n), // 1 SOL
      commitment: "confirmed",
    });
  }
}

// ---------------------------------------------------------------------------
// Transaction helper: build, sign, send, confirm
// ---------------------------------------------------------------------------

export async function sendInstructions(
  feePayer: KeyPairSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );

  const signed = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirm(signed, { commitment: "confirmed" });

  const signature = getSignatureFromTransaction(signed);
  console.log(`Transaction: ${signature}`);
  return signature;
}

// ---------------------------------------------------------------------------
// Display helper: raw balance + what wallets actually show (scaled UI amount)
// ---------------------------------------------------------------------------

export async function printBalance(label: string, tokenAccount: Address): Promise<void> {
  const { value } = await rpc.getTokenAccountBalance(tokenAccount).send();
  console.log(`${label}: raw=${value.amount} ui=${value.uiAmountString}`);
}
