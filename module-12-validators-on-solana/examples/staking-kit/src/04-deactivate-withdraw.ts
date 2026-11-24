/**
 * 04-deactivate-withdraw.ts - unstake: deactivate, wait for cooldown, withdraw.
 *
 * Unstaking is a two-step process separated by an epoch boundary:
 *
 *   run 1 (stake is active)       -> Deactivate (stake authority signs)
 *   ...wait for the next epoch (~2 days on mainnet)...
 *   run 2 (stake is inactive)     -> Withdraw everything (withdraw authority signs)
 *
 * Run this script twice. It inspects the account and does whichever step is
 * due. Withdrawing the full balance, rent reserve included, closes the account.
 *
 * Enterprise note: this cooldown is why treasury teams that need same-day
 * liquidity hold a liquid staking token (LST) instead of, or alongside,
 * native stake - see Module 6.
 */

import { fetchStakeStateAccount, getDeactivateInstruction, getWithdrawInstruction } from "@solana-program/stake";
import { NEVER, loadOrCreateOwner, requireStakeAccount, rpc, send, sol } from "./helpers.js";

const owner = await loadOrCreateOwner();
const stakeAddress = requireStakeAccount();

const [account, { epoch }] = await Promise.all([
  fetchStakeStateAccount(rpc, stakeAddress),
  rpc.getEpochInfo().send(),
]);
const state = account.data.state;

const withdrawAll = async () => {
  const { value: balance } = await rpc.getBalance(stakeAddress).send();
  const sig = await send(owner, [
    getWithdrawInstruction({
      stake: stakeAddress,
      recipient: owner.address,
      withdrawAuthority: owner,
      args: balance,
    }),
  ]);
  console.log(`Withdrew ${sol(balance)} SOL to ${owner.address} - stake account closed.`);
  console.log(`Transaction: ${sig}`);
};

if (state.__kind === "Initialized") {
  // Never delegated: can be withdrawn immediately.
  await withdrawAll();
} else if (state.__kind === "Stake") {
  const d = state.fields[1].delegation;

  if (d.deactivationEpoch === NEVER) {
    const sig = await send(owner, [getDeactivateInstruction({ stake: stakeAddress, stakeAuthority: owner })]);
    console.log(`Deactivated in epoch ${epoch}. Transaction: ${sig}`);
    console.log(`Stake stops earning now; it is withdrawable from epoch ${epoch + 1n}. Re-run this script then.`);
  } else if (epoch > d.deactivationEpoch) {
    await withdrawAll();
  } else {
    console.log(
      `Deactivation requested in epoch ${d.deactivationEpoch}; still cooling down. ` +
        `Re-run in epoch ${d.deactivationEpoch + 1n} (current: ${epoch}).`,
    );
  }
} else {
  console.log(`Nothing to do - account state is ${state.__kind}.`);
}
