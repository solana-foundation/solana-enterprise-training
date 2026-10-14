// Step 4 - the subscriber cancels.
//
// Default: cancel at the end of the current billing period. Collection still
// succeeds until then, and fails afterwards. Pass --now to run the dual-signed
// immediate cancellation instead (merchant + subscriber), which is bound to the
// period start observed at signing - if the period has rolled since, the
// program rejects it as StaleSubscriptionApproval.

import { address } from "@solana/kit";
import { fetchSubscriptionDelegation } from "@solana/subscriptions";
import { clientFor, loadSigner, readState } from "./common.js";

const subscriber = await loadSigner("subscriber");
const merchant = await loadSigner("merchant");
const client = clientFor(subscriber);

const { planPda, subscriptionPda } = readState();
if (!planPda || !subscriptionPda) throw new Error("run create-plan and subscribe first");

const before = await fetchSubscriptionDelegation(client.rpc, address(subscriptionPda));

if (process.argv.includes("--now")) {
  await client.subscriptions.instructions
    .cancelSubscriptionNow({
      merchant,
      planPda: address(planPda),
      subscriptionPda: address(subscriptionPda),
      expectedCurrentPeriodStartTs: before.data.currentPeriodStartTs,
    })
    .sendTransaction();
  console.log("Cancelled immediately (dual-signed)");
} else {
  await client.subscriptions.instructions
    .cancelSubscription({ planPda: address(planPda), subscriptionPda: address(subscriptionPda) })
    .sendTransaction();
  console.log("Cancelled at period end");
}

const after = await fetchSubscriptionDelegation(client.rpc, address(subscriptionPda));
console.log(`  expiresAtTs: ${after.data.expiresAtTs}`);
console.log("Collection still works until expiry; afterwards run: npm run revoke");
