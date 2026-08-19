/**
 * 05-seize.ts - Court-ordered seizure via PermanentDelegate.
 *
 * A regulator orders part of the investor's position moved to the issuer's
 * treasury. The PermanentDelegate extension lets the issuer sign a transfer
 * out of ANY holder's account - no approval from the holder, no custom
 * program. This is the EVM "force transfer" pattern (issuer-controlled
 * transferFrom) as a mint-level capability.
 *
 * Note the treasury ATA is also born frozen (DefaultAccountState applies to
 * everyone, including the issuer) - it must be thawed before it can receive.
 */

import { address } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getThawAccountInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token-2022";
import { DECIMALS, ensureFunded, loadIssuer, printBalance, requireState, sendInstructions, writeState } from "./helpers.js";

const SEIZE_AMOUNT = 25_000n * 10n ** BigInt(DECIMALS); // 25,000 shares

const issuer = await loadIssuer();
await ensureFunded(issuer.address);
const mint = address(requireState("mint"));
const investorAta = address(requireState("investorAta"));

const [treasuryAta] = await findAssociatedTokenPda({
  owner: issuer.address,
  mint,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
});
console.log(`Treasury token account: ${treasuryAta}`);

await sendInstructions(issuer, [
  // The issuer's own ATA starts frozen too - onboard the treasury.
  getCreateAssociatedTokenIdempotentInstruction({
    payer: issuer,
    ata: treasuryAta,
    owner: issuer.address,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  }),
  getThawAccountInstruction({ account: treasuryAta, mint, owner: issuer }),
  // The seizure: issuer signs as permanent delegate over the investor's account.
  getTransferCheckedInstruction({
    source: investorAta,
    mint,
    destination: treasuryAta,
    authority: issuer, // permanent delegate, not the owner
    amount: SEIZE_AMOUNT,
    decimals: DECIMALS,
  }),
]);

await printBalance("Investor after seizure", investorAta);
await printBalance("Treasury after seizure", treasuryAta);

writeState({ treasuryAta });
console.log("Seized 25,000 TBIL from the investor without their signature.");
