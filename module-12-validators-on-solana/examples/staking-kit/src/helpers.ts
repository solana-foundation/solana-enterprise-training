/**
 * helpers.ts - shared RPC setup, a persisted demo wallet, and a send helper.
 *
 * The four scripts run as separate processes (often an epoch apart), so the
 * demo wallet and the stake account address are saved to `.stake-state.json`
 * between runs. This file is for a throwaway devnet / localnet wallet only -
 * never store a real key this way.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getRandomValues } from "node:crypto";
import {
  type Address,
  type Instruction,
  type KeyPairSigner,
  address,
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
} from "@solana/kit";

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

export const httpUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
// Derive the websocket endpoint; a local test validator serves it on port 8900.
const wsUrl = httpUrl
  .replace("https://", "wss://")
  .replace("http://", "ws://")
  .replace(":8899", ":8900");

export const rpc = createSolanaRpc(httpUrl);
export const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const airdrop = airdropFactory({ rpc, rpcSubscriptions });

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const sol = (l: bigint | number) => (Number(l) / 1e9).toFixed(4);

/** Epoch value the stake program uses for "never" (u64::MAX). */
export const NEVER = 18_446_744_073_709_551_615n;

// ---------------------------------------------------------------------------
// Persisted demo state
// ---------------------------------------------------------------------------

const STATE_FILE = ".stake-state.json";

type State = { ownerSeedHex: string; stakeAccount?: string; voteAccount?: string };

export function loadState(): State | undefined {
  if (!existsSync(STATE_FILE)) return undefined;
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

export function saveState(state: State) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * The demo "owner" wallet: fee payer, stake authority and withdraw authority
 * all in one key. In production these are three different keys (see the
 * module README, section 4) and the withdrawer lives in cold storage.
 */
export async function loadOrCreateOwner(): Promise<KeyPairSigner> {
  let state = loadState();
  if (!state) {
    const seed = getRandomValues(new Uint8Array(32));
    state = { ownerSeedHex: Buffer.from(seed).toString("hex") };
    saveState(state);
  }
  return createKeyPairSignerFromPrivateKeyBytes(Buffer.from(state.ownerSeedHex, "hex"));
}

export function requireStakeAccount(): Address {
  const state = loadState();
  if (!state?.stakeAccount) {
    throw new Error("No stake account yet - run `npm run create-and-delegate` first.");
  }
  return address(state.stakeAccount);
}

// ---------------------------------------------------------------------------
// Funding and sending
// ---------------------------------------------------------------------------

export async function ensureFunded(owner: KeyPairSigner, minSol: bigint) {
  const { value: balance } = await rpc.getBalance(owner.address).send();
  if (balance >= minSol * LAMPORTS_PER_SOL) return;
  console.log(`Requesting ${minSol} SOL airdrop for ${owner.address}...`);
  try {
    await airdrop({
      recipientAddress: owner.address,
      lamports: lamports(minSol * LAMPORTS_PER_SOL),
      commitment: "confirmed",
    });
  } catch (e) {
    throw new Error(
      `Airdrop failed (devnet faucet is rate limited). Fund ${owner.address} ` +
        `at https://faucet.solana.com and re-run.\n${e}`,
    );
  }
}

export async function send(payer: KeyPairSigner, instructions: Instruction[]) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirm(signed, { commitment: "confirmed" });
  return getSignatureFromTransaction(signed);
}
