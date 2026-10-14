// Step 1 - the merchant publishes billing terms.
//
// The plan PDA is derived from (merchant, planId). `destinations` restricts
// where collected funds may land; `pullers` restricts who may collect.

import { findPlanPda, fetchPlan } from "@solana/subscriptions";
import { clientFor, loadSigner, TOKEN_MINT, PLAN_ID, PLAN_AMOUNT, PLAN_PERIOD_HOURS, PLAN_METADATA_URI, writeState, ui } from "./common.js";

const merchant = await loadSigner("merchant");
const puller = await loadSigner("puller");
const client = clientFor(merchant);

const [planPda] = await findPlanPda({ owner: merchant.address, planId: PLAN_ID });

await client.subscriptions.instructions
  .createPlan({
    planId: PLAN_ID,
    mint: TOKEN_MINT,
    amount: PLAN_AMOUNT,
    periodHours: PLAN_PERIOD_HOURS,
    endTs: 0n,                              // open-ended
    destinations: [merchant.address],       // funds may only go to the merchant's accounts
    pullers: [puller.address],              // only the ops key may collect
    metadataUri: PLAN_METADATA_URI,
  })
  .sendTransaction();

const plan = await fetchPlan(client.rpc, planPda);
console.log("Plan created:", planPda);
const d = plan.data.data;
console.log(`  ${ui(d.terms.amount)} every ${d.terms.periodHours} hours`);
console.log(`  pullers: ${d.pullers.length}, destinations: ${d.destinations.length}`);
writeState({ planPda });
