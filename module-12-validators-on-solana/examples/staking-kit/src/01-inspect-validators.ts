/**
 * 01-inspect-validators.ts - read the validator set straight from RPC.
 *
 * `getVoteAccounts` returns every vote account the cluster knows about,
 * split into `current` (voted recently) and `delinquent` (stopped voting).
 * This is the raw data behind dashboards like validators.app and stakewiz,
 * and the first thing to check before choosing where to delegate.
 *
 * No wallet and no transactions - read-only.
 */

import { rpc, httpUrl, sol } from "./helpers.js";

const TOP_N = Number(process.env.TOP_N ?? 10);

const [{ current, delinquent }, epochInfo, inflation, minDelegation] = await Promise.all([
  rpc.getVoteAccounts({ commitment: "confirmed" }).send(),
  rpc.getEpochInfo().send(),
  rpc.getInflationRate().send(),
  rpc.getStakeMinimumDelegation().send(),
]);

const all = [...current, ...delinquent];
const totalStake = all.reduce((sum, v) => sum + v.activatedStake, 0n);
const delinquentStake = delinquent.reduce((sum, v) => sum + v.activatedStake, 0n);

console.log(`Cluster: ${httpUrl}`);
console.log(
  `Epoch ${epochInfo.epoch} - slot ${epochInfo.slotIndex}/${epochInfo.slotsInEpoch} ` +
    `(${((Number(epochInfo.slotIndex) / Number(epochInfo.slotsInEpoch)) * 100).toFixed(1)}% through)`,
);
console.log(`Inflation this epoch: ${(inflation.total * 100).toFixed(2)}% total`);
console.log(`Minimum stake delegation: ${sol(minDelegation.value)} SOL`);
console.log(
  `Vote accounts: ${current.length} current, ${delinquent.length} delinquent ` +
    `(${((Number(delinquentStake) / Number(totalStake || 1n)) * 100).toFixed(2)}% of stake delinquent)`,
);
console.log(`Total active stake: ${sol(totalStake)} SOL\n`);

// --- Top validators by stake -------------------------------------------------

const top = [...current].sort((a, b) => Number(b.activatedStake - a.activatedStake)).slice(0, TOP_N);

console.log(`Top ${top.length} validators by active stake:`);
console.table(
  top.map((v) => ({
    vote: v.votePubkey,
    stakeSol: sol(v.activatedStake),
    stakePct: ((Number(v.activatedStake) / Number(totalStake)) * 100).toFixed(2) + "%",
    commission: `${v.commission}%`,
    lastVote: Number(v.lastVote),
    slotsBehind: Number(epochInfo.absoluteSlot - v.lastVote),
  })),
);

// --- Superminority: the fewest validators that together hold > 1/3 of stake ---
// (Halting threshold under classic BFT; a rough decentralisation signal.)

let running = 0n;
let superminority = 0;
for (const v of [...all].sort((a, b) => Number(b.activatedStake - a.activatedStake))) {
  running += v.activatedStake;
  superminority++;
  if (running * 3n > totalStake) break;
}
console.log(`Superminority (validators holding > 1/3 of stake): ${superminority}`);

if (delinquent.length > 0) {
  console.log(`\nDelinquent (not voting) - do not delegate here:`);
  for (const v of delinquent.slice(0, TOP_N)) {
    console.log(`  ${v.votePubkey}  ${sol(v.activatedStake)} SOL  last vote ${v.lastVote}`);
  }
}
