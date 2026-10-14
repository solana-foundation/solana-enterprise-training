// Step 3 - the puller collects one period's payment.
//
// This is the "crank". The puller must be listed on the plan; the receiver's
// owner must be in the plan's destinations. Run it twice in the same period to
// see the program reject the second pull (PeriodNotElapsed) - the schedule is
// enforced on-chain, not by the collector's good behaviour.
//
// The catch block classifies failures the way a production collector must
// (README Section 9): balance problems go to dunning, compliance freezes go to
// a compliance queue, schedule errors mean "not yet", and everything else is
// a bug to alert on.

import { address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  fetchPlan,
  SUBSCRIPTIONS_ERROR__PERIOD_NOT_ELAPSED,
  SUBSCRIPTIONS_ERROR__SUBSCRIPTION_CANCELLED,
  SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_PERIOD_LIMIT,
  SUBSCRIPTIONS_ERROR__UNAUTHORIZED,
  SUBSCRIPTIONS_ERROR__UNAUTHORIZED_DESTINATION,
  SUBSCRIPTIONS_ERROR__STALE_SUBSCRIPTION_AUTHORITY,
} from "@solana/subscriptions";
import { clientFor, loadSigner, ataOf, TOKEN_MINT, readState, ui } from "./common.js";

type Outcome = "collected" | "not-yet" | "dunning" | "compliance" | "stopped" | "bug";

const puller = await loadSigner("puller");
const merchant = await loadSigner("merchant");
const subscriber = await loadSigner("subscriber");
const client = clientFor(puller);

const { planPda, subscriptionPda } = readState();
if (!planPda || !subscriptionPda) throw new Error("run create-plan and subscribe first");

const plan = await fetchPlan(client.rpc, address(planPda));
const amount = plan.data.data.terms.amount;

let outcome: Outcome;
try {
  await client.subscriptions.instructions
    .transferSubscription({
      delegator: subscriber.address,
      tokenMint: TOKEN_MINT,
      subscriptionPda: address(subscriptionPda),
      planPda: address(planPda),
      amount,
      receiverAta: await ataOf(merchant.address),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    })
    .sendTransaction();
  outcome = "collected";
  console.log(`Collected ${ui(amount)} from ${subscriber.address}`);
} catch (e) {
  outcome = classify(e);
  console.log(`Collection failed -> ${outcome}`);
  console.log(`  ${(e as Error).message.split("\n")[0]}`);
}

function classify(e: unknown): Outcome {
  // Program-level errors carry a numeric code; the SDK exports the constants.
  const code = extractProgramErrorCode(e);
  if (code !== undefined) {
    switch (code) {
      case SUBSCRIPTIONS_ERROR__PERIOD_NOT_ELAPSED: return "not-yet";
      case SUBSCRIPTIONS_ERROR__SUBSCRIPTION_CANCELLED:
      case SUBSCRIPTIONS_ERROR__STALE_SUBSCRIPTION_AUTHORITY: return "stopped";
      case SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_PERIOD_LIMIT:
      case SUBSCRIPTIONS_ERROR__UNAUTHORIZED:
      case SUBSCRIPTIONS_ERROR__UNAUTHORIZED_DESTINATION: return "bug"; // collector misconfiguration
    }
  }
  const msg = String((e as Error)?.message ?? e);
  if (/insufficient funds/i.test(msg)) return "dunning";       // Token program: balance short
  if (/frozen/i.test(msg)) return "compliance";                 // Token program: AccountFrozen
  return "bug";
}

// Kit surfaces custom program errors on the failed transaction; the exact
// shape depends on the transport, so we search the error chain defensively.
function extractProgramErrorCode(e: unknown): number | undefined {
  let cur: any = e;
  for (let i = 0; i < 6 && cur; i++) {
    const c = cur?.context?.code ?? cur?.code;
    if (typeof c === "number" && c >= 0x1770) return c; // custom program error range
    cur = cur.cause;
  }
  const m = /custom program error: (0x[0-9a-f]+)/i.exec(String((e as Error)?.message ?? ""));
  return m ? parseInt(m[1], 16) : undefined;
}

process.exitCode = outcome === "bug" ? 1 : 0;
