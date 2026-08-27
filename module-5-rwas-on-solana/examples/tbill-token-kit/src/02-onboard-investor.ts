/**
 * 02-onboard-investor.ts - KYC approval, on-chain.
 *
 * Because the mint uses DefaultAccountState = Frozen, an investor's token
 * account is born frozen: it exists but cannot receive or send. "Onboarding"
 * is the issuer (freeze authority) thawing it after off-chain KYC passes.
 *
 * The allowlist is therefore implicit: the set of approved investors is
 * exactly the set of thawed accounts. There is no deny-list to maintain.
 */

import { generateKeyPairSigner } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getThawAccountInstruction,
} from "@solana-program/token-2022";
import { address } from "@solana/kit";
import { ensureFunded, loadIssuer, requireState, rpc, sendInstructions, writeState } from "./helpers.js";

const issuer = await loadIssuer();
await ensureFunded(issuer.address);
const mint = address(requireState("mint"));

// A fresh wallet standing in for the investor. They never sign anything in
// this demo - the issuer pays for and controls the compliance actions.
const investor = await generateKeyPairSigner();
console.log(`Investor wallet: ${investor.address}`);

const [investorAta] = await findAssociatedTokenPda({
  owner: investor.address,
  mint,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
});
console.log(`Investor token account (ATA): ${investorAta}`);

// Create the ATA (born frozen) and thaw it - the KYC approval - atomically.
await sendInstructions(issuer, [
  getCreateAssociatedTokenIdempotentInstruction({
    payer: issuer,
    ata: investorAta,
    owner: investor.address,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  }),
  getThawAccountInstruction({
    account: investorAta,
    mint,
    owner: issuer, // the freeze authority
  }),
]);

const tokenAccount = await fetchToken(rpc, investorAta);
console.log(`Account state: ${tokenAccount.data.state === 1 ? "Initialized (thawed)" : tokenAccount.data.state}`);

writeState({ investor: investor.address, investorAta });
console.log("Investor onboarded - their account is thawed and can now hold TBIL.");
