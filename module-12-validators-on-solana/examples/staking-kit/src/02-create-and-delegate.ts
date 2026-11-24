/**
 * 02-create-and-delegate.ts - create a native stake account and delegate it.
 *
 * Three instructions, one atomic transaction:
 *
 *   1. System Program: allocate a 200-byte account owned by the Stake Program,
 *      funded with rent-exempt reserve + the amount to stake
 *   2. Stake Program: InitializeChecked - record the stake + withdraw authorities
 *   3. Stake Program: DelegateStake - point the stake at a validator's vote account
 *
 * The SOL never leaves your control: the stake account is owned by the Stake
 * Program, and only your withdraw authority can take lamports out. The
 * validator can earn on it but can never move it.
 *
 * Choose the validator with VOTE_ACCOUNT=<pubkey>; otherwise the script picks
 * the current (non-delinquent) validator with the lowest commission.
 */

import { address, generateKeyPairSigner } from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  STAKE_PROGRAM_ADDRESS,
  getDelegateStakeInstruction,
  getInitializeCheckedInstruction,
} from "@solana-program/stake";
import {
  LAMPORTS_PER_SOL,
  ensureFunded,
  loadOrCreateOwner,
  loadState,
  rpc,
  saveState,
  send,
  sol,
} from "./helpers.js";

/** Size of a StakeStateV2 account. Fixed for every stake account. */
const STAKE_ACCOUNT_SIZE = 200n;
const STAKE_SOL = BigInt(process.env.STAKE_SOL ?? 1);

const owner = await loadOrCreateOwner();
console.log(`Owner (fee payer + stake/withdraw authority): ${owner.address}`);
await ensureFunded(owner, STAKE_SOL + 1n);

// --- Pick a validator ----------------------------------------------------------

let voteAccount;
if (process.env.VOTE_ACCOUNT) {
  voteAccount = address(process.env.VOTE_ACCOUNT);
} else {
  const { current } = await rpc.getVoteAccounts().send();
  if (current.length === 0) throw new Error("No active vote accounts on this cluster.");
  const pick = [...current].sort(
    (a, b) => a.commission - b.commission || Number(b.activatedStake - a.activatedStake),
  )[0];
  voteAccount = address(pick.votePubkey);
  console.log(`Picked validator ${pick.votePubkey} (commission ${pick.commission}%)`);
}

// --- Size the account -------------------------------------------------------

const [rentReserve, minDelegation] = await Promise.all([
  rpc.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE).send(),
  rpc.getStakeMinimumDelegation().send(),
]);
const delegated = STAKE_SOL * LAMPORTS_PER_SOL;
if (delegated < minDelegation.value) {
  throw new Error(`STAKE_SOL is below the minimum delegation of ${sol(minDelegation.value)} SOL`);
}

// A stake account is a fresh keypair-addressed account (not a PDA). Its key
// only signs this one creation; afterwards the authorities control it.
const stakeAccount = await generateKeyPairSigner();

const signature = await send(owner, [
  getCreateAccountInstruction({
    payer: owner,
    newAccount: stakeAccount,
    lamports: rentReserve + delegated,
    space: STAKE_ACCOUNT_SIZE,
    programAddress: STAKE_PROGRAM_ADDRESS,
  }),
  // "Checked" variant: the withdraw authority must sign, proving the key exists
  // and is controlled - guards against typo'd authorities that would lock funds.
  getInitializeCheckedInstruction({
    stake: stakeAccount.address,
    stakeAuthority: owner.address,
    withdrawAuthority: owner,
  }),
  getDelegateStakeInstruction({
    stake: stakeAccount.address,
    vote: voteAccount,
    // Legacy slot that used to hold the stake config account; the program
    // ignores it but the account list still expects something here.
    unused: address("StakeConfig11111111111111111111111111111111"),
    stakeAuthority: owner,
  }),
]);

saveState({ ...loadState()!, stakeAccount: stakeAccount.address, voteAccount });

const { epoch } = await rpc.getEpochInfo().send();
console.log(`\nStake account: ${stakeAccount.address}`);
console.log(`Delegated:     ${sol(delegated)} SOL (+ ${sol(rentReserve)} SOL rent reserve)`);
console.log(`Validator:     ${voteAccount}`);
console.log(`Transaction:   ${signature}`);
console.log(
  `\nDelegated in epoch ${epoch}. The stake starts earning once it is active at the ` +
    `next epoch boundary (epoch ${epoch + 1n}). Check with \`npm run check-stake\`.`,
);
