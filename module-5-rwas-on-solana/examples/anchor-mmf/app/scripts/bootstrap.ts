// Creates a fresh fund on the running localnet and writes the persona keys to
// public/localnet.json for the console. Same steps as tests 1-4 in
// programs/anchor-mmf/tests/test_e2e_token_acl.rs:
//
//   1. mmf_admin initialize  - default-frozen mint, Config, genesis roles
//   2. hook setup            - extra-account-meta list + rate-limit config
//   3. Token ACL             - take over freeze authority, enable permissionless thaw
//   4. ABL gate              - create an Allow-mode list and bind it to the mint
//
// Holders are not onboarded here: that is what the console demonstrates.

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { sendIxs, type TxRecord } from "../src/lib/chain";
import { PERSONA_KEYS, PERSONA_LABEL, PersonaKey, TOKEN_ACL_ID } from "../src/lib/constants";
import type { LocalnetFile } from "../src/lib/env";
import * as ix from "../src/lib/instructions";
import { pdas } from "../src/lib/names";
import { makePrograms } from "../src/lib/programs";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../public/localnet.json");

function fail(msg: string): never {
  console.error(`\n${msg}`);
  process.exit(1);
}

function check(step: string, rec: TxRecord) {
  if (rec.ok) {
    console.log(`  ok  ${step}`);
    return;
  }
  console.error(`  FAIL ${step}: ${rec.error?.name} - ${rec.error?.message}`);
  console.error(rec.logs.map((l) => `       ${l}`).join("\n"));
  process.exit(1);
}

async function main() {
  const conn = new Connection(rpcUrl, "confirmed");
  try {
    await conn.getVersion();
  } catch {
    fail(`No localnet at ${rpcUrl}. Start it with \`yarn localnet\` first.`);
  }
  const acl = await conn.getAccountInfo(TOKEN_ACL_ID);
  if (!acl?.executable) fail("Token ACL is not loaded on this cluster. Start the localnet with `yarn localnet`.");
  if (await conn.getAccountInfo(pdas.config())) {
    fail("This localnet already has a fund (the Config PDA exists, and there is only one per deployment).\nRestart `yarn localnet` for a fresh one.");
  }

  const p = makePrograms(conn);
  const personas = Object.fromEntries(PERSONA_KEYS.map((k) => [k, Keypair.generate()])) as Record<PersonaKey, Keypair>;
  const mint = Keypair.generate();
  const { admin, responder } = personas;
  const A = admin.publicKey;

  console.log(`Bootstrapping a fund on ${rpcUrl}`);
  await Promise.all(
    PERSONA_KEYS.map(async (k) => {
      const sig = await conn.requestAirdrop(personas[k].publicKey, 100 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
    }),
  );
  console.log("  ok  airdropped 100 SOL to each persona");

  check(
    "1. initialize (mint, Config, genesis roles)",
    await sendIxs(conn, "initialize", [await ix.initialize(p, A, mint.publicKey, responder.publicKey)], [admin, mint]),
  );

  check(
    "2. hook: extra-account-meta list + rate-limit config",
    await sendIxs(
      conn,
      "hook setup",
      [await ix.initExtraMetas(p, A, mint.publicKey), await ix.initRateConfig(p, A, mint.publicKey)],
      [admin],
    ),
  );

  check(
    "3. Token ACL: create_config + enable permissionless thaw",
    await sendIxs(
      conn,
      "token acl",
      [ix.aclCreateConfig(A, mint.publicKey), ix.aclTogglePermissionless(A, mint.publicKey, false, true)],
      [admin],
    ),
  );

  const listSeed = randomBytes(32);
  const listConfig = pdas.listConfig(A, listSeed);
  check(
    "4. ABL gate: Allow-mode list bound to the mint",
    await sendIxs(
      conn,
      "gate",
      [ix.gateCreateList(A, listSeed), ix.gateSetupExtraMetas(A, mint.publicKey, listConfig)],
      [admin],
    ),
  );

  const file: LocalnetFile = {
    rpcUrl,
    mint: mint.publicKey.toBase58(),
    listConfig: listConfig.toBase58(),
    personas: Object.fromEntries(PERSONA_KEYS.map((k) => [k, Array.from(personas[k].secretKey)])) as Record<PersonaKey, number[]>,
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(file, null, 2));

  console.log("\nFund ready.");
  console.log(`  mint         ${mint.publicKey.toBase58()}`);
  console.log(`  allow list   ${listConfig.toBase58()}`);
  for (const k of PERSONA_KEYS) console.log(`  ${PERSONA_LABEL[k].padEnd(12)} ${personas[k].publicKey.toBase58()}`);
  console.log(`\nWrote ${outPath}. Start the console with \`yarn dev\`.`);
}

main().catch((e) => fail(e instanceof Error ? e.stack ?? e.message : String(e)));
