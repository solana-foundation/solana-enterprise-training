/**
 * 06-inspect-token.ts
 * ────────────────────────────────────────────────────────────────
 * Reads the full on-chain state of the stablecoin mint and
 * displays all extensions, authorities, and configuration.
 *
 * This is useful for compliance audits: everything is verifiable
 * on-chain, including who holds each authority and which
 * extensions are active.
 *
 * Usage:
 *   npm run inspect-token
 */

import { inspectToken } from "@solana/mosaic-sdk";
import { address } from "@solana/kit";
import { getRpc, heading, mintExplorerUrl } from "./helpers.js";

const MINT_ADDRESS = process.env.MINT_ADDRESS ?? "";

async function main() {
  heading("MOSAIC - Inspect Token (Compliance Audit View)");

  if (!MINT_ADDRESS) throw new Error("Set MINT_ADDRESS in .env");

  const rpc = getRpc();
  const mint = address(MINT_ADDRESS);

  console.log("  Fetching on-chain token data...\n");

  const result = await inspectToken(rpc, mint);

  // ── Token identity ─────────────────────────────────────────────
  console.log("  TOKEN IDENTITY");
  console.log("  ─────────────────────────────────────────");
  console.log("  Name       :", result.metadata?.name ?? "-");
  console.log("  Symbol     :", result.metadata?.symbol ?? "-");
  console.log("  Decimals   :", result.supplyInfo.decimals);
  console.log("  Supply     :", result.supplyInfo.supply.toString());
  console.log("  URI        :", result.metadata?.uri ?? "-");
  console.log("  Address    :", result.address);
  console.log("  Program    :", result.programId);
  console.log("  Type       :", result.detectedPatterns.join(", "));
  console.log();

  // ── Authorities ────────────────────────────────────────────────
  console.log("  AUTHORITIES (who controls what)");
  console.log("  ─────────────────────────────────────────");
  console.log("  Mint authority              :", result.authorities.mintAuthority ?? "none");
  console.log("  Freeze authority            :", result.authorities.freezeAuthority ?? "none");
  console.log("  Metadata authority          :", result.authorities.metadataAuthority ?? "none");
  console.log("  Pausable authority          :", result.authorities.pausableAuthority ?? "none");
  console.log("  Confidential balances auth  :", result.authorities.confidentialBalancesAuthority ?? "none");
  console.log("  Permanent delegate          :", result.authorities.permanentDelegate ?? "none");
  console.log();

  // ── Extensions ─────────────────────────────────────────────────
  console.log("  ACTIVE EXTENSIONS");
  console.log("  ─────────────────────────────────────────");
  for (const ext of result.extensions) {
    console.log(`  ✓ ${ext.name}`);
    if (ext.details && Object.keys(ext.details).length > 0) {
      for (const [key, value] of Object.entries(ext.details)) {
        if (key !== "name" && key !== "symbol" && key !== "uri") {
          console.log(`      ${key}: ${value}`);
        }
      }
    }
  }
  console.log();

  // ── Compliance status ──────────────────────────────────────────
  console.log("  COMPLIANCE STATUS");
  console.log("  ─────────────────────────────────────────");
  console.log("  Pausable     :", result.isPausable ? "Yes" : "No");
  console.log("  ACL mode     :", result.aclMode);
  console.log("  sRFC-37      :", result.enableSrfc37 ? "Enabled" : "Disabled");
  console.log("  Token-2022   :", result.isToken2022 ? "Yes" : "No");
  console.log();
  console.log(`  Explorer: ${mintExplorerUrl(MINT_ADDRESS)}`);
}

main().catch((err) => {
  console.error("\n  Error:", err.message ?? err);
  process.exit(1);
});
