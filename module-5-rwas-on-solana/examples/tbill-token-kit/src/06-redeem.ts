/**
 * 06-redeem.ts - Redemption: burn the investor's remaining shares.
 *
 * The investor asked to redeem; cash settles off-chain, and the transfer
 * agent burns the shares. PermanentDelegate authority covers burns as well
 * as transfers, so the issuer retires the position directly - the standard
 * transfer-agent model for registered funds.
 */

import { address } from "@solana/kit";
import { fetchToken, getBurnCheckedInstruction } from "@solana-program/token-2022";
import { DECIMALS, ensureFunded, loadIssuer, printBalance, requireState, rpc, sendInstructions } from "./helpers.js";

const issuer = await loadIssuer();
await ensureFunded(issuer.address);
const mint = address(requireState("mint"));
const investorAta = address(requireState("investorAta"));

// Redeem the investor's full remaining position.
const { data } = await fetchToken(rpc, investorAta);
console.log(`Redeeming ${data.amount} raw units (all remaining shares)`);

await sendInstructions(issuer, [
  getBurnCheckedInstruction({
    account: investorAta,
    mint,
    authority: issuer, // permanent delegate
    amount: data.amount,
    decimals: DECIMALS,
  }),
]);

await printBalance("Investor after redemption", investorAta);
console.log("Position retired. Lifecycle complete: create -> onboard -> issue -> accrue -> seize -> redeem.");
