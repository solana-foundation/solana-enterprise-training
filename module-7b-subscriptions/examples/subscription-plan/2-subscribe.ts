// Step 2 - the subscriber accepts the plan.
//
// Two things happen, both signed by the subscriber:
//   a) initSubscriptionAuthority - ONE program-controlled delegate PDA per
//      (user, mint). The subscriber's token account approves it once. Skipped
//      if it already exists (reused across every delegation on this mint).
//   b) subscribe - creates the subscription PDA (plan, subscriber), snapshotting
//      the plan terms the subscriber consented to.
//
// After this, inspect the subscriber's token account: the delegate is the
// authority PDA, not the merchant. The merchant never holds a delegate.

import { address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { fetchMaybeSubscriptionAuthority, findSubscriptionAuthorityPda, findSubscriptionDelegationPda, fetchSubscriptionDelegation } from "@solana/subscriptions";
import { clientFor, loadSigner, ataOf, TOKEN_MINT, PLAN_ID, readState, writeState } from "./common.js";

const subscriber = await loadSigner("subscriber");
const merchant = await loadSigner("merchant");
const client = clientFor(subscriber);

const { planPda } = readState();
if (!planPda) throw new Error("no plan - run: npm run create-plan");

// a) Subscription Authority
const [authorityPda] = await findSubscriptionAuthorityPda({ user: subscriber.address, tokenMint: TOKEN_MINT });
const existing = await fetchMaybeSubscriptionAuthority(client.rpc, authorityPda);
if (!existing.exists) {
  await client.subscriptions.instructions
    .initSubscriptionAuthority({
      tokenMint: TOKEN_MINT,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      userAta: await ataOf(subscriber.address),
    })
    .sendTransaction();
  console.log("Subscription Authority created:", authorityPda);
} else {
  console.log("Subscription Authority already exists:", authorityPda);
}

// b) Subscribe - the plugin fetches the live plan terms for the consent snapshot.
await client.subscriptions.instructions
  .subscribe({ merchant: merchant.address, planId: PLAN_ID, tokenMint: TOKEN_MINT })
  .sendTransaction();

const [subscriptionPda] = await findSubscriptionDelegationPda({ planPda: address(planPda), subscriber: subscriber.address });
const sub = await fetchSubscriptionDelegation(client.rpc, subscriptionPda);
console.log("Subscribed:", subscriptionPda);
console.log(`  current period starts at ${sub.data.currentPeriodStartTs}`);
writeState({ subscriptionPda });
