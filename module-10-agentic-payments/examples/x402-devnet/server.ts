// x402 server - lab solution for Module 10 (Agentic Payments).
// Built on @solana/kit (Web3.js 2.0).
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
import {
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  getBase64Encoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  type Base64EncodedWireTransaction,
  type Signature,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { readFileSync } from "node:fs";
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

const rpc = createSolanaRpc(RPC_URL);

// Override with SERVER_WALLET_PATH if desired.
const SERVER_WALLET_PATH =
  process.env.SERVER_WALLET_PATH ?? "./server-wallet.json";
const serverSigner = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(readFileSync(SERVER_WALLET_PATH, "utf-8")))
);
const [RECIPIENT_TOKEN_ACCOUNT] = await findAssociatedTokenPda({
  mint: TOKEN_MINT,
  owner: serverSigner.address,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});

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
  return jwt.sign({ scope: "premium", paymentSignature }, JWT_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
  });
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
// Poll signature status until the requested commitment is reached
// ---------------------------------------------------------------------------
async function confirmSignature(
  signature: Signature,
  timeoutMs = 60_000
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("Timed out waiting for confirmation");
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
          amount: Number(PRICE_BASE_UNITS),
          amountUi: Number(PRICE_BASE_UNITS) / 10 ** TOKEN_DECIMALS,
          mint: TOKEN_MINT,
          payTo: RECIPIENT_TOKEN_ACCOUNT,
          recipientWallet: serverSigner.address,
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

    const wireTransaction = proof.payload
      .serializedTransaction as Base64EncodedWireTransaction;

    // 2) Introspect the instruction bytes - never trust client-claimed
    //    fields. SPL Token Transfer layout: data[0] = 3, data[1..8] = amount
    //    (u64 LE); accounts = [source, destination, owner].
    const wireBytes = getBase64Encoder().encode(wireTransaction);
    const decodedTx = getTransactionDecoder().decode(wireBytes);
    const message = getCompiledTransactionMessageDecoder().decode(
      decodedTx.messageBytes
    );
    // Narrow away the v1 transaction format, which compiles differently.
    if (!("instructions" in message)) {
      return res
        .status(402)
        .json({ error: "Unsupported transaction message format" });
    }

    let validTransfer = false;
    let claimedAmount = 0n;
    for (const ix of message.instructions) {
      const programAddress =
        message.staticAccounts[ix.programAddressIndex];
      if (programAddress !== TOKEN_PROGRAM_ADDRESS) continue;
      const data = ix.data;
      if (!data || data.length < 9 || data[0] !== 3) continue;
      claimedAmount = new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength
      ).getBigUint64(1, true);
      const destinationIndex = ix.accountIndices?.[1];
      if (destinationIndex === undefined) continue;
      const destination = message.staticAccounts[destinationIndex];
      if (
        destination === RECIPIENT_TOKEN_ACCOUNT &&
        claimedAmount >= PRICE_BASE_UNITS
      ) {
        validTransfer = true;
        break;
      }
    }
    if (!validTransfer) {
      return res.status(402).json({
        error:
          "No valid token transfer to the quoted account for the quoted amount",
      });
    }
    console.log(
      `Instruction verified: ${claimedAmount} base units -> ${RECIPIENT_TOKEN_ACCOUNT}`
    );

    // 3) Simulate before submitting - reject failures without broadcasting.
    const simulation = await rpc
      .simulateTransaction(wireTransaction, { encoding: "base64" })
      .send();
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
    const signature = await rpc
      .sendTransaction(wireTransaction, {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send();
    console.log(`Submitted: ${signature}`);
    await confirmSignature(signature);

    // 5) Verify actual balance changes from transaction metadata - the
    //    amount received is the ground truth, not the instruction contents.
    const confirmedTx = await rpc
      .getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
        encoding: "json",
      })
      .send();
    if (!confirmedTx?.meta) {
      return res
        .status(402)
        .json({ error: "Could not fetch confirmed transaction" });
    }
    const accountKeys = confirmedTx.transaction.message.accountKeys;
    const post = confirmedTx.meta.postTokenBalances ?? [];
    const pre = confirmedTx.meta.preTokenBalances ?? [];
    let amountReceived = 0n;
    for (const pb of post) {
      if (accountKeys[pb.accountIndex] !== RECIPIENT_TOKEN_ACCOUNT) continue;
      const before = pre.find((p) => p.accountIndex === pb.accountIndex);
      amountReceived =
        BigInt(pb.uiTokenAmount.amount) -
        BigInt(before?.uiTokenAmount.amount ?? "0");
      break;
    }
    if (amountReceived < PRICE_BASE_UNITS) {
      return res.status(402).json({
        error: `Insufficient payment: received ${amountReceived}, expected ${PRICE_BASE_UNITS}`,
      });
    }
    console.log(
      `Payment verified: ${Number(amountReceived) / 10 ** TOKEN_DECIMALS} tokens received`
    );

    // Payment verified - serve content and issue the session JWT.
    const sessionToken = issueSessionToken(signature);
    return res.json({
      ...premiumContent(),
      paidVia: "x402-payment",
      paymentDetails: {
        signature,
        amountBaseUnits: Number(amountReceived),
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
  console.log(`Recipient token account: ${RECIPIENT_TOKEN_ACCOUNT}`);
  console.log(
    `Price: ${PRICE_BASE_UNITS} base units (${Number(PRICE_BASE_UNITS) / 10 ** TOKEN_DECIMALS} tokens)`
  );
});
