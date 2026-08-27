/**
 * 04-nav-update.ts - Daily NAV accrual via the ScaledUiAmount multiplier.
 *
 * The fund accrued yield overnight, so NAV per share moved from 1.0000 to
 * 1.0004. On-chain, raw balances do not change - one instruction updates the
 * mint's multiplier, and every wallet, explorer and RPC `uiAmount` in the
 * world now displays balance x 1.0004.
 *
 * Contrast with EVM rebasing tokens (stETH-style), which either rewrite
 * every balance or wrap the token; here display-scaling is a mint property.
 */

import { address } from "@solana/kit";
import { getUpdateMultiplierScaledUiMintInstruction } from "@solana-program/token-2022";
import { ensureFunded, loadIssuer, printBalance, requireState, sendInstructions } from "./helpers.js";

const NEW_MULTIPLIER = 1.0004; // today's NAV per share

const issuer = await loadIssuer();
await ensureFunded(issuer.address);
const mint = address(requireState("mint"));
const investorAta = address(requireState("investorAta"));

await printBalance("Before NAV update", investorAta);

await sendInstructions(issuer, [
  getUpdateMultiplierScaledUiMintInstruction({
    mint,
    authority: issuer,
    multiplier: NEW_MULTIPLIER,
    effectiveTimestamp: 0n, // effective immediately
  }),
]);

await printBalance("After NAV update ", investorAta);
console.log(`Raw balance unchanged; displayed value scaled by ${NEW_MULTIPLIER}.`);
