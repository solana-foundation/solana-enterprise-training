/**
 * 01-create-stablecoin.ts
 * ────────────────────────────────────────────────────────────────
 * Creates a new enterprise-grade stablecoin on Solana devnet using
 * the Mosaic SDK's stablecoin template.
 *
 * Extensions enabled:
 *   • Metadata          - on-chain name, symbol, URI
 *   • Pausable          - halt all transfers in an emergency
 *   • DefaultAccountState - in blocklist mode new accounts start active;
 *     blocklisted wallets are frozen individually via Token ACL
 *   • ConfidentialBalances - encrypted balances for privacy
 *   • PermanentDelegate - authority can seize / force-transfer tokens
 *
 * Usage:
 *   npm run create-token
 */

import { createStablecoinInitTransaction } from "@solana/mosaic-sdk";
import {
  getRpc,
  loadAuthority,
  newKeypair,
  signAndSend,
  heading,
  mintExplorerUrl,
} from "./helpers.js";

async function main() {
  heading("MOSAIC - Create Enterprise Stablecoin");

  // ── 1. Setup ──────────────────────────────────────────────────
  const rpc = getRpc();
  const authority = await loadAuthority();
  const mint = await newKeypair();

  console.log("  Authority :", authority.address);
  console.log("  New mint  :", mint.address);
  console.log();

  // ── 2. Build the stablecoin init transaction ──────────────────
  console.log("  Building stablecoin transaction with extensions:");
  console.log("    Metadata (USDF / USD Fidelity)");
  console.log("    Pausable");
  console.log("    Confidential Balances");
  console.log("    Permanent Delegate");
  console.log("    Default Account State (accounts start active in blocklist mode)");
  console.log("    sRFC-37 Token ACL + ABL Blocklist");
  console.log();

  const tx = await createStablecoinInitTransaction(
    rpc,
    "USD Fidelity",                       // name
    "USDF",                               // symbol
    6,                                     // decimals (6 = standard for stablecoins)
    "https://example.com/usdf-metadata.json", // metadata URI
    authority,                             // mintAuthority
    mint,                                  // mint keypair
    authority,                             // feePayer
    "blocklist",                           // aclMode - blocklist (sanctions screening)
    authority.address,                     // metadataAuthority
    authority.address,                     // pausableAuthority
    authority.address,                     // confidentialBalancesAuthority
    authority.address,                     // permanentDelegateAuthority
    true,                                  // enableSrfc37 - on-chain access control
    // The freeze authority must start as the signing authority: the Token ACL
    // createConfig instruction verifies it before taking over freeze control.
    // (The SDK's default of the Token ACL program id is rejected on devnet.)
    authority.address,                     // freezeAuthority
  );

  // ── 3. Sign and send ──────────────────────────────────────────
  console.log("  Signing and sending transaction...");
  const signature = await signAndSend(tx);

  console.log(`\n  Stablecoin created!`);
  console.log(`  Signature : ${signature}`);
  console.log(`  Mint      : ${mint.address}`);
  console.log(`  Explorer  : ${mintExplorerUrl(mint.address)}`);
  console.log();
  console.log(`  Save this mint address in your .env file as MINT_ADDRESS`);
  console.log(`   MINT_ADDRESS=${mint.address}`);
}

main().catch((err) => {
  console.error("\n  Error:", err.message ?? err);
  process.exit(1);
});
