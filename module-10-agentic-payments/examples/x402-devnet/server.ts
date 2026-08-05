// x402 server - lab solution for Module 10 (Agentic Payments).
//
// Implements the full self-verified flow (no facilitator):
//   1. GET /premium without X-PAYMENT  -> 402 + PaymentRequirements
//   2. GET /premium with X-PAYMENT     -> decode, introspect, simulate,
//                                         submit, confirm, verify balances,
//                                         then 200 + content + JWT
//   3. GET /premium with Authorization: Bearer <jwt> -> 200 without payment
//      (lab step 3 - one payment grants SESSION_TTL_SECONDS of access)
//
// Demonstration code - unaudited, not production ready.

import express from "express";
import jwt from "jsonwebtoken";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { readFileSync } from "fs";
import {
  RPC_URL,
  TOKEN_MINT,
  TOKEN_DECIMALS,
  PRICE_BASE_UNITS,
  SERVER_PORT,
  SESSION_TTL_SECONDS,
  JWT_SECRET,
  X402_VERSION,
  SCHEME,
  NETWORK,
} from "./config.js";

const connection = new Connection(RPC_URL, "confirmed");

// Override with SERVER_WALLET_PATH if desired.
const SERVER_WALLET_PATH =
  process.env.SERVER_WALLET_PATH ?? "./server-wallet.json";
const serverKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(SERVER_WALLET_PATH, "utf-8")))
);
const RECIPIENT_TOKEN_ACCOUNT = getAssociatedTokenAddressSync(
  TOKEN_MINT,
  serverKeypair.publicKey
);

const app = express();

// ---------------------------------------------------------------------------
// The protected content - completely payment-unaware
// ---------------------------------------------------------------------------
function premiumContent() {
  return {
    report: {
      data: "premium market data",
      generatedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Lab step 3: JWT session - one payment buys a window of access
// ---------------------------------------------------------------------------
function issueSessionToken(paymentSignature: string): string {
  return jwt.sign(
    { scope: "premium", paymentSignature },
    JWT_SECRET,
    { expiresIn: SESSION_TTL_SECONDS }
  );
}

function verifySessionToken(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  try {
    jwt.verify(header.slice("Bearer ".length), JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The x402 endpoint
// ---------------------------------------------------------------------------
app.get("/premium", async (req, res) => {
  // 0) Valid session token? Serve without payment (lab step 3).
  if (verifySessionToken(req.header("Authorization"))) {
    console.log("Valid JWT session - serving without payment");
    return res.json({ ...premiumContent(), paidVia: "jwt-session" });
  }

  const xPaymentHeader = req.header("X-Payment");

  // No payment: return the 402 challenge with PaymentRequirements.
  if (!xPaymentHeader) {
    console.log("Quote requested - responding 402");
    return res.status(402).json({
      x402Version: X402_VERSION,
      accepts: [
        {
          scheme: SCHEME,
          network: NETWORK,
          amount: PRICE_BASE_UNITS,
          amountUi: PRICE_BASE_UNITS / 10 ** TOKEN_DECIMALS,
          mint: TOKEN_MINT.toBase58(),
          payTo: RECIPIENT_TOKEN_ACCOUNT.toBase58(),
          recipientWallet: serverKeypair.publicKey.toBase58(),
        },
      ],
      description: "Premium market data",
    });
  }

  // Payment provided: treat the transaction as untrusted input and verify.
  try {
    // 1) Decode the base64 X-PAYMENT header (x402 standard).
    const proof = JSON.parse(
      Buffer.from(xPaymentHeader, "base64").toString("utf-8")
    ) as {
      x402Version: number;
      scheme: string;
      network: string;
      payload: { serializedTransaction: string };
    };

    if (proof.scheme !== SCHEME || proof.network !== NETWORK) {
      return res.status(402).json({
        error: `Unsupported scheme/network: ${proof.scheme}/${proof.network}`,
      });
    }

    const txBuffer = Buffer.from(
      proof.payload.serializedTransaction,
      "base64"
    );
    const tx = Transaction.from(txBuffer);

    // 2) Introspect the instruction bytes - never trust client-claimed
    //    fields. SPL Token Transfer layout: data[0] = 3, data[1..8] = amount
    //    (u64 LE); keys = [source, destination, owner].
    let validTransfer = false;
    let claimedAmount = 0;
    for (const ix of tx.instructions) {
      if (!ix.programId.equals(TOKEN_PROGRAM_ID)) continue;
      if (ix.data.length < 9 || ix.data[0] !== 3) continue;
      claimedAmount = Number(ix.data.readBigUInt64LE(1));
      const destination = ix.keys[1]?.pubkey;
      if (
        destination?.equals(RECIPIENT_TOKEN_ACCOUNT) &&
        claimedAmount >= PRICE_BASE_UNITS
      ) {
        validTransfer = true;
        break;
      }
    }
    if (!validTransfer) {
      return res.status(402).json({
        error: "No valid token transfer to the quoted account for the quoted amount",
      });
    }
    console.log(`Instruction verified: ${claimedAmount} base units -> ${RECIPIENT_TOKEN_ACCOUNT.toBase58()}`);

    // 3) Simulate before submitting - reject failures without broadcasting.
    const simulation = await connection.simulateTransaction(tx);
    if (simulation.value.err) {
      return res.status(402).json({
        error: "Transaction simulation failed",
        details: simulation.value.err,
        logs: simulation.value.logs,
      });
    }
    console.log("Simulation OK");

    // 4) Submit and wait for confirmed commitment. The chain rejects
    //    duplicate signatures, so a proof cannot be replayed.
    const signature = await connection.sendRawTransaction(txBuffer, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    console.log(`Submitted: ${signature}`);
    const confirmation = await connection.confirmTransaction(
      signature,
      "confirmed"
    );
    if (confirmation.value.err) {
      return res.status(402).json({
        error: "Transaction failed on-chain",
        details: confirmation.value.err,
      });
    }

    // 5) Verify actual balance changes from transaction metadata - the
    //    amount received is the ground truth, not the instruction contents.
    const confirmedTx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!confirmedTx?.meta) {
      return res
        .status(402)
        .json({ error: "Could not fetch confirmed transaction" });
    }
    const post = confirmedTx.meta.postTokenBalances ?? [];
    const pre = confirmedTx.meta.preTokenBalances ?? [];
    let amountReceived = 0;
    for (const pb of post) {
      const key =
        confirmedTx.transaction.message.staticAccountKeys[pb.accountIndex];
      if (!key?.equals(RECIPIENT_TOKEN_ACCOUNT)) continue;
      const before = pre.find((p) => p.accountIndex === pb.accountIndex);
      amountReceived =
        Number(pb.uiTokenAmount.amount) -
        Number(before?.uiTokenAmount.amount ?? "0");
      break;
    }
    if (amountReceived < PRICE_BASE_UNITS) {
      return res.status(402).json({
        error: `Insufficient payment: received ${amountReceived}, expected ${PRICE_BASE_UNITS}`,
      });
    }
    console.log(
      `Payment verified: ${amountReceived / 10 ** TOKEN_DECIMALS} tokens received`
    );

    // Payment verified - serve content and issue the session JWT.
    const sessionToken = issueSessionToken(signature);
    return res.json({
      ...premiumContent(),
      paidVia: "x402-payment",
      paymentDetails: {
        signature,
        amountBaseUnits: amountReceived,
        explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      },
      // Lab step 3: reuse this for SESSION_TTL_SECONDS without paying again.
      sessionToken,
      sessionExpiresInSeconds: SESSION_TTL_SECONDS,
    });
  } catch (e) {
    console.error("Payment verification error:", e);
    return res.status(402).json({
      error: "Payment verification failed",
      details: e instanceof Error ? e.message : "Unknown error",
    });
  }
});

app.listen(SERVER_PORT, () => {
  console.log(`x402 server listening on :${SERVER_PORT}`);
  console.log(`Recipient token account: ${RECIPIENT_TOKEN_ACCOUNT.toBase58()}`);
  console.log(
    `Price: ${PRICE_BASE_UNITS} base units (${PRICE_BASE_UNITS / 10 ** TOKEN_DECIMALS} tokens)`
  );
});
