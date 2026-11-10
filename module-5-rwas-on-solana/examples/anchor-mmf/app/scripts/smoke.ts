// Runs the full class demo against a freshly bootstrapped localnet, through
// the same instruction builders, error decoder and state loader the console
// uses. Run after `yarn localnet` + `yarn bootstrap`:
//
//   yarn smoke
//
// Every expected rejection is asserted by its decoded error name, so this is
// also the console's integration test. It consumes the fund (restart the
// localnet and bootstrap again before a class).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair } from "@solana/web3.js";
import { sendIxs, timeTravel, type TxRecord } from "../src/lib/chain";
import { HolderKey, PersonaKey, TIMELOCK_DELAY } from "../src/lib/constants";
import { parseEnv, registerNames, type LocalnetFile } from "../src/lib/env";
import { fmtAmount, mmf } from "../src/lib/format";
import * as ix from "../src/lib/instructions";
import type { Ix } from "../src/lib/instructions";
import { pdas } from "../src/lib/names";
import { makePrograms } from "../src/lib/programs";
import { loadFund } from "../src/lib/state";

const here = dirname(fileURLToPath(import.meta.url));
const file = JSON.parse(readFileSync(resolve(here, "../public/localnet.json"), "utf8")) as LocalnetFile;
const env = parseEnv(file);
registerNames(env);
const conn = new Connection(env.rpcUrl, "confirmed");
const p = makePrograms(conn);
const { mint, listConfig, personas } = env;
const key = (k: PersonaKey) => personas[k].publicKey;

let failures = 0;
async function run(title: string, as: PersonaKey, ixs: Ix[] | Promise<Ix>[], signers: Keypair[] = []) {
  const built = await Promise.all(ixs);
  return sendIxs(conn, title, built, [personas[as], ...signers], as);
}
function ok(rec: TxRecord) {
  if (rec.ok) console.log(`  ok    ${rec.title}`);
  else {
    failures++;
    console.log(`  FAIL  ${rec.title}: expected success, got ${rec.error?.name} - ${rec.error?.message}`);
    console.log(rec.logs.map((l) => `          ${l}`).join("\n"));
  }
}
function rejects(rec: TxRecord, name: string) {
  if (!rec.ok && rec.error?.name.startsWith(name)) console.log(`  ok    ${rec.title} -> ${rec.error.name}`);
  else {
    failures++;
    console.log(`  FAIL  ${rec.title}: expected ${name}, got ${rec.ok ? "success" : rec.error?.name}`);
    console.log(rec.logs.map((l) => `          ${l}`).join("\n"));
  }
}
function expect(cond: boolean, what: string) {
  if (cond) console.log(`  ok    ${what}`);
  else {
    failures++;
    console.log(`  FAIL  ${what}`);
  }
}
const balance = async (k: HolderKey) => (await loadFund(conn, p, env)).holders[k].amount;

async function fastForward(readyAt: number) {
  await timeTravel(env.rpcUrl, readyAt + 2);
  // Let a slot pass so the new clock is visible to the next transaction.
  await new Promise((r) => setTimeout(r, 1200));
}

async function onboard(h: HolderKey) {
  ok(await run(`allowlist ${h}`, "admin", [ix.gateAddWallet(key("admin"), listConfig, key(h))]));
  ok(await run(`create ATA ${h}`, h, [ix.createAta(key(h), key(h), mint)]));
  expect((await loadFund(conn, p, env)).holders[h].frozen, `${h} ATA starts frozen`);
  ok(await run(`self-thaw ${h}`, h, [ix.aclThawPermissionless(key(h), mint, key(h), listConfig)]));
  ok(await run(`rate-limit account ${h}`, h, [ix.initRateLimit(p, key(h), key(h), mint)]));
}

async function main() {
  const start = await loadFund(conn, p, env);
  if (!start.initialized) throw new Error("No fund on this localnet. Run `yarn bootstrap`.");
  if (start.mint!.supply !== 0n) throw new Error("This fund has already been used. Restart the localnet and bootstrap again.");

  console.log("Skipping onboarding");
  rejects(await run("mint to Outsider", "admin", [ix.mintMmf(p, key("admin"), mint, key("outsider"), mmf(10))]), "AccountFrozen");
  rejects(await run("Outsider self-thaw (not allowlisted)", "outsider", [ix.createAta(key("outsider"), key("outsider"), mint), ix.aclThawPermissionless(key("outsider"), mint, key("outsider"), listConfig)]), "GateRejected");

  console.log("Onboarding");
  await onboard("holderA");
  await onboard("holderB");
  await onboard("admin");
  ok(await run("mint 200 to Holder A", "admin", [ix.mintMmf(p, key("admin"), mint, key("holderA"), mmf(200))]));

  console.log("Rate limit");
  ok(await run("A sends 60 to B", "holderA", [ix.transferChecked(mint, key("holderA"), key("holderB"), mmf(60))]));
  rejects(await run("A sends 50 more", "holderA", [ix.transferChecked(mint, key("holderA"), key("holderB"), mmf(50))]), "RateLimitExceeded");

  console.log("Timelock: force transfer 120 from A to treasury");
  const seed = BigInt(Date.now());
  const fromAta = pdas.ata(key("holderA"), mint);
  const toAta = pdas.ata(key("admin"), mint);
  const proposal = pdas.timelock(seed, key("admin"));
  ok(await run("propose", "admin", [ix.createProposal(p, key("admin"), seed, "forceTransfer", ix.encodeAction.forceTransfer(fromAta, toAta, mmf(120)))]));
  rejects(await run("Admin approves own proposal", "admin", [ix.respondProposal(p, key("admin"), proposal)]), "AccountNotInitialized");
  ok(await run("Responder approves", "responder", [ix.respondProposal(p, key("responder"), proposal)]));
  rejects(await run("execute before delay", "admin", [ix.forceTransfer(p, key("admin"), mint, proposal, fromAta, toAta, mmf(120))]), "TimelockNotReady");
  const accepted = (await loadFund(conn, p, env)).proposals.find((x) => x.address.equals(proposal))!;
  expect(accepted.status === "accepted" && accepted.readyAt === accepted.timestamp + TIMELOCK_DELAY.forceTransfer, "proposal accepted with a 24h delay");
  await fastForward(accepted.readyAt!);
  const bAta = pdas.ata(key("holderB"), mint);
  rejects(await run("execute with edited recipient", "admin", [ix.forceTransfer(p, key("admin"), mint, proposal, fromAta, bAta, mmf(120))]), "TimelockActionMismatch");
  ok(await run("execute as approved (over the cap)", "admin", [ix.forceTransfer(p, key("admin"), mint, proposal, fromAta, toAta, mmf(120))]));
  expect((await balance("admin")) === mmf(120), `treasury holds ${fmtAmount(await balance("admin"))}`);

  console.log("Pause");
  ok(await run("pause", "admin", [ix.setPaused(p, key("admin"), mint, true)]));
  expect((await loadFund(conn, p, env)).mint!.paused, "mint reads as paused");
  rejects(await run("transfer while paused", "holderB", [ix.transferChecked(mint, key("holderB"), key("holderA"), mmf(1))]), "MintPaused");
  rejects(await run("Holder A tries to resume", "holderA", [ix.setPaused(p, key("holderA"), mint, false)]), "AccountNotInitialized");
  ok(await run("resume", "admin", [ix.setPaused(p, key("admin"), mint, false)]));

  console.log("Sidelining Holder B");
  ok(await run("freeze B", "admin", [ix.aclFreeze(key("admin"), mint, key("holderB"))]));
  rejects(await run("A sends to frozen B", "holderA", [ix.transferChecked(mint, key("holderA"), key("holderB"), mmf(1))]), "AccountFrozen");
  ok(await run("B self-thaws (still allowlisted)", "holderB", [ix.aclThawPermissionless(key("holderB"), mint, key("holderB"), listConfig)]));
  ok(await run("remove B from allow list", "admin", [ix.gateRemoveWallet(key("admin"), listConfig, key("holderB"))]));
  ok(await run("freeze B again", "admin", [ix.aclFreeze(key("admin"), mint, key("holderB"))]));
  rejects(await run("B self-thaws (removed)", "holderB", [ix.aclThawPermissionless(key("holderB"), mint, key("holderB"), listConfig)]), "GateRejected");
  ok(await run("authority thaw B", "admin", [ix.aclThaw(key("admin"), mint, key("holderB"))]));

  console.log("Burns");
  rejects(await run("plain BurnChecked from treasury", "admin", [ix.burnChecked(key("admin"), mint, mmf(1))]), "InvalidInstruction");
  ok(await run("permissioned burn 50 from treasury", "admin", [ix.permissionedBurn(p, key("admin"), mint, mmf(50))]));
  rejects(await run("Holder A permissioned burn (no role)", "holderA", [ix.permissionedBurn(p, key("holderA"), mint, mmf(1))]), "AccountNotInitialized");

  console.log("Timelock: grant MINTER to Holder B (48h)");
  const seed2 = seed + 1n;
  const roleProposal = pdas.timelock(seed2, key("admin"));
  ok(await run("propose role grant", "admin", [ix.createProposal(p, key("admin"), seed2, "setRole", ix.encodeAction.setRole("MINTER", key("holderB"), true))]));
  ok(await run("Responder approves", "responder", [ix.respondProposal(p, key("responder"), roleProposal)]));
  const rp = (await loadFund(conn, p, env)).proposals.find((x) => x.address.equals(roleProposal))!;
  await fastForward(rp.readyAt!);
  ok(await run("execute role grant", "admin", [ix.setRole(p, key("admin"), key("holderB"), "MINTER", true, roleProposal)]));
  const roles = (await loadFund(conn, p, env)).roles;
  expect(roles.some((r) => r.role === "MINTER" && r.grantee.equals(key("holderB")) && r.granted), "Holder B now holds MINTER");

  console.log("Rate-limit settings");
  ok(await run("set cap to 500 MMF / 10 min", "admin", [ix.setRateLimit(p, key("admin"), mint, mmf(500), 600)]));
  rejects(await run("Holder A changes the cap", "holderA", [ix.setRateLimit(p, key("holderA"), mint, mmf(1), 600)]), "NotRateLimitAuthority");

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
