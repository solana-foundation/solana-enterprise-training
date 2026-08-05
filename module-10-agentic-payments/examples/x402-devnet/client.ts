// x402 client - lab solution for Module 10 (Agentic Payments).
//
// Flow:
//   1. GET /premium                      -> expect 402 + PaymentRequirements
//   2. Build an SPL transfer for the quoted amount to the quoted account
//   3. Sign it locally - do NOT submit (the server broadcasts it)
//   4. Retry with the base64 proof in the X-PAYMENT header -> 200 + content
//   5. (lab step 3) Reuse the returned JWT: a second request with
//      Authorization: Bearer <jwt> succeeds with no payment at all.
//
// Run with --reuse-jwt to only exercise step 5 against a saved token.

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { readFileSync, writeFileSync, existsSync } from "fs";
import {
  RPC_URL,
  SERVER_PORT,
  X402_VERSION,
  SCHEME,
  NETWORK,
} from "./config.js";

const ENDPOINT = `http://localhost:${SERVER_PORT}/premium`;
const JWT_FILE = "./session-token.json";

const connection = new Connection(RPC_URL, "confirmed");
// Override with your own wallet, e.g. the Solana CLI default:
//   WALLET_PATH=~/.config/solana/id.json npm run client
const WALLET_PATH = process.env.WALLET_PATH ?? "./client-wallet.json";
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(WALLET_PATH, "utf-8")))
);

async function requestWithJwt(): Promise<boolean> {
  if (!existsSync(JWT_FILE)) return false;
  const { token } = JSON.parse(readFileSync(JWT_FILE, "utf-8"));
  const res = await fetch(ENDPOINT, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 200) {
    console.log("JWT session still valid - content served without payment:");
    console.log(await res.json());
    return true;
  }
  console.log(`JWT rejected (${res.status}) - falling back to payment`);
  return false;
}

async function run() {
  // Optional fast path: reuse a previously earned session token.
  if (process.argv.includes("--reuse-jwt")) {
    const ok = await requestWithJwt();
    if (ok) return;
  }

  // 1) Request the quote.
  const quoteRes = await fetch(ENDPOINT);
  if (quoteRes.status !== 402) {
    throw new Error(`Expected 402 quote, got ${quoteRes.status}`);
  }
  const quote = (await quoteRes.json()) as {
    accepts: Array<{
      amount: number;
      amountUi: number;
      mint: string;
      payTo: string;
      recipientWallet: string;
    }>;
  };
  const terms = quote.accepts[0];
  console.log("402 Payment Required:");
  console.log(`  amount: ${terms.amountUi} tokens (${terms.amount} base units)`);
  console.log(`  payTo:  ${terms.payTo}`);

  const mint = new PublicKey(terms.mint);
  const recipientTokenAccount = new PublicKey(terms.payTo);
  const recipientWallet = new PublicKey(terms.recipientWallet);
  const payerTokenAccount = getAssociatedTokenAddressSync(
    mint,
    payer.publicKey
  );

  // 2) Build the transfer. Create the recipient ATA in the same transaction
  //    if it does not exist yet (a classic Module 7 lesson).
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    blockhash,
    lastValidBlockHeight,
  });

  let recipientExists = true;
  try {
    await getAccount(connection, recipientTokenAccount);
  } catch {
    recipientExists = false;
  }
  if (!recipientExists) {
    console.log("Recipient ATA missing - adding create instruction");
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        recipientTokenAccount,
        recipientWallet,
        mint
      )
    );
  }

  tx.add(
    createTransferInstruction(
      payerTokenAccount,
      recipientTokenAccount,
      payer.publicKey,
      terms.amount
    )
  );

  // 3) Sign locally. Deliberately not submitted - the server broadcasts it,
  //    which gives the server control over settlement timing.
  tx.sign(payer);
  const serializedTransaction = tx.serialize().toString("base64");
  console.log("Transaction signed (not submitted)");

  // 4) Retry with the X-PAYMENT header (base64-encoded JSON, x402 standard).
  const proof = {
    x402Version: X402_VERSION,
    scheme: SCHEME,
    network: NETWORK,
    payload: { serializedTransaction },
  };
  const paidRes = await fetch(ENDPOINT, {
    headers: {
      "X-Payment": Buffer.from(JSON.stringify(proof)).toString("base64"),
    },
  });
  const result = (await paidRes.json()) as {
    paymentDetails?: { explorerUrl: string };
    sessionToken?: string;
    sessionExpiresInSeconds?: number;
    error?: string;
  };

  if (paidRes.status !== 200) {
    throw new Error(`Payment rejected: ${JSON.stringify(result)}`);
  }
  console.log("\n200 OK - content received:");
  console.log(result);
  if (result.paymentDetails) {
    console.log(`\nExplorer: ${result.paymentDetails.explorerUrl}`);
  }

  // 5) Persist the session JWT for reuse (lab step 3).
  if (result.sessionToken) {
    writeFileSync(JWT_FILE, JSON.stringify({ token: result.sessionToken }));
    console.log(
      `\nSession JWT saved to ${JWT_FILE} ` +
        `(valid ${result.sessionExpiresInSeconds}s). ` +
        `Try: npm run client:jwt`
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
