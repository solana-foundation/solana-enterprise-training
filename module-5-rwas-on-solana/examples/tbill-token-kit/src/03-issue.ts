/**
 * 03-issue.ts - Issue shares against a subscription.
 *
 * The investor wired cash off-chain; the transfer agent mints the matching
 * shares on-chain. Note the emergent guarantee: minting to an un-onboarded
 * investor is impossible, because their ATA would still be frozen and
 * MintTo fails on frozen accounts. Compliance is enforced by account state,
 * not by application code remembering to check.
 */

import { address } from "@solana/kit";
import { getMintToInstruction } from "@solana-program/token-2022";
import { DECIMALS, ensureFunded, loadIssuer, printBalance, requireState, sendInstructions } from "./helpers.js";

const AMOUNT = 100_000n * 10n ** BigInt(DECIMALS); // 100,000 shares

const issuer = await loadIssuer();
await ensureFunded(issuer.address);
const mint = address(requireState("mint"));
const investorAta = address(requireState("investorAta"));

console.log(`Issuing 100,000 TBIL to ${investorAta}`);

await sendInstructions(issuer, [
  getMintToInstruction({
    mint,
    token: investorAta,
    mintAuthority: issuer,
    amount: AMOUNT,
  }),
]);

await printBalance("Investor balance", investorAta);
