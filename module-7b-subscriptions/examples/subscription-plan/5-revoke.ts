// Step 5 - after the cancellation expiry has elapsed, close the subscription
// PDA and recover its rent. Optionally close the Subscription Authority too
// (only allowed once no delegation depends on it).

import { address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { clientFor, loadSigner, readState, writeState, TOKEN_MINT } from "./common.js";

const subscriber = await loadSigner("subscriber");
const client = clientFor(subscriber);

const { planPda, subscriptionPda } = readState();
if (!planPda || !subscriptionPda) throw new Error("nothing to revoke");

await client.subscriptions.instructions
  .revokeSubscription({ planPda: address(planPda), subscriptionPda: address(subscriptionPda) })
  .sendTransaction();
console.log("Subscription revoked, rent returned");
writeState({ subscriptionPda: undefined });

if (process.argv.includes("--close-authority")) {
  await client.subscriptions.instructions
    .revokeSubscriptionAuthority({ tokenMint: TOKEN_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS })
    .sendTransaction();
  console.log("Subscription Authority closed; token account delegate cleared");
}
