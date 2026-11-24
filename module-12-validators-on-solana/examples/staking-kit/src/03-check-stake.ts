/**
 * 03-check-stake.ts - decode the stake account and look up its rewards.
 *
 * Shows:
 *   - the authorities and lockup stored in the account (who can do what)
 *   - the delegation: validator, amount, activation / deactivation epochs
 *   - a lifecycle status derived from those epochs vs. the current epoch
 *   - inflation rewards paid to the account in the most recent epochs
 *
 * Rewards are paid at the start of each epoch directly into the stake account
 * (and auto-compound, since they are added to the delegated amount).
 */

import { fetchMaybeStakeStateAccount } from "@solana-program/stake";
import { NEVER, requireStakeAccount, rpc, sol } from "./helpers.js";

const stakeAddress = requireStakeAccount();
const [account, { epoch }] = await Promise.all([
  fetchMaybeStakeStateAccount(rpc, stakeAddress),
  rpc.getEpochInfo().send(),
]);
if (!account.exists) {
  console.log(`Stake account ${stakeAddress} no longer exists (fully withdrawn and closed).`);
  process.exit(0);
}
const { value: balance } = await rpc.getBalance(stakeAddress).send();

console.log(`Stake account: ${stakeAddress}`);
console.log(`Balance:       ${sol(balance)} SOL`);
console.log(`Current epoch: ${epoch}`);

const state = account.data.state;
if (state.__kind !== "Stake") {
  console.log(`State:         ${state.__kind} (not delegated)`);
  process.exit(0);
}

const [meta, stake] = state.fields;
const d = stake.delegation;

console.log(`\nAuthorities`);
console.log(`  staker:      ${meta.authorized.staker}   (can delegate / deactivate)`);
console.log(`  withdrawer:  ${meta.authorized.withdrawer}   (can withdraw / change authorities)`);
console.log(`  lockup:      ${meta.lockup.epoch > 0n ? `until epoch ${meta.lockup.epoch}` : "none"}`);
console.log(`  rent reserve ${sol(meta.rentExemptReserve)} SOL`);

console.log(`\nDelegation`);
console.log(`  validator:   ${d.voterPubkey}`);
console.log(`  delegated:   ${sol(d.stake)} SOL`);
console.log(`  activated:   epoch ${d.activationEpoch}`);
console.log(`  deactivated: ${d.deactivationEpoch === NEVER ? "-" : `epoch ${d.deactivationEpoch}`}`);

// Simplified lifecycle. The exact effective amount also depends on the
// cluster-wide warmup/cooldown limit; when only a small fraction of total
// stake is moving (the normal case) it completes in a single epoch.
let status: string;
if (d.deactivationEpoch === NEVER) {
  status = epoch > d.activationEpoch ? "ACTIVE - earning rewards" : "ACTIVATING - active from next epoch";
} else if (epoch > d.deactivationEpoch) {
  status = "INACTIVE - cooled down, withdrawable";
} else {
  status = "DEACTIVATING - withdrawable from next epoch";
}
console.log(`  status:      ${status}`);

// --- Rewards -----------------------------------------------------------------

const lookback = 3n;
const epochs = Array.from({ length: Number(lookback) }, (_, i) => epoch - 1n - BigInt(i)).filter(
  (e) => e >= 0n && e >= d.activationEpoch,
);

if (epochs.length === 0) {
  console.log(`\nNo completed epochs since activation yet - no rewards to show.`);
} else {
  console.log(`\nInflation rewards (paid at the start of the following epoch):`);
  for (const e of epochs) {
    try {
      const [reward] = await rpc.getInflationReward([stakeAddress], { epoch: e }).send();
      console.log(
        reward
          ? `  epoch ${e}: +${reward.amount} lamports` +
              (reward.commission != null ? ` (validator commission ${reward.commission}%)` : "")
          : `  epoch ${e}: none`,
      );
    } catch {
      console.log(`  epoch ${e}: not available from this RPC node`);
    }
  }
}
