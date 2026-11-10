// Starts an offline Surfpool localnet with every program the fund needs
// preloaded at its real address:
//
//   mmf_admin, mmf_transfer_hook  - from ../target/deploy (run `anchor build`)
//   Token ACL, ABL gate           - vendored fixtures used by the e2e test
//   Token-2022                    - a current devnet build (the bundled one
//                                   predates the PermissionedBurn extension)
//
// The programs are written into a Surfpool account snapshot, so the localnet
// works without any network access. Extra arguments are passed to
// `surfpool start` (for example `yarn localnet --port 8999`).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_ID, HOOK_ID, MMF_ADMIN_ID, TOKEN_2022_ID, TOKEN_ACL_ID } from "../src/lib/constants";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, "../..");
const fixtures = resolve(workspace, "programs/anchor-mmf/tests/fixtures");
const outDir = resolve(here, "../.localnet");

const programs = [
  { id: MMF_ADMIN_ID, name: "mmf_admin", path: resolve(workspace, "target/deploy/mmf_admin.so") },
  { id: HOOK_ID, name: "mmf_transfer_hook", path: resolve(workspace, "target/deploy/mmf_transfer_hook.so") },
  { id: TOKEN_ACL_ID, name: "Token ACL", path: resolve(fixtures, "token_acl.so") },
  { id: GATE_ID, name: "ABL gate", path: resolve(fixtures, "token_acl_gate_program.so") },
  { id: TOKEN_2022_ID, name: "Token-2022", path: resolve(fixtures, "token_2022.so") },
];

const missing = programs.filter((p) => !existsSync(p.path));
if (missing.length) {
  console.error("Missing program binaries:");
  for (const p of missing) console.error(`  ${p.name}: ${p.path}`);
  console.error("\nRun `anchor build` in the anchor-mmf folder first.");
  process.exit(1);
}

// Loaded as non-upgradeable (BPF loader v2) programs: the ELF is the account
// data. Simple, and upgrades don't matter on a throwaway localnet.
const snapshot = Object.fromEntries(
  programs.map((p) => [
    p.id.toBase58(),
    {
      lamports: 1_000_000_000,
      owner: "BPFLoader2111111111111111111111111111111111",
      executable: true,
      rentEpoch: 0,
      data: readFileSync(p.path).toString("base64"),
    },
  ]),
);
mkdirSync(outDir, { recursive: true });
const snapshotPath = resolve(outDir, "programs.json");
writeFileSync(snapshotPath, JSON.stringify(snapshot));

console.log("Preloading programs:");
for (const p of programs) console.log(`  ${p.name.padEnd(18)} ${p.id.toBase58()}`);
console.log("\nNext, in another terminal: yarn bootstrap && yarn dev\n");

const args = [
  "start",
  "--offline",
  "--no-deploy",
  "--no-tui",
  "--airdrop-amount", "0",
  "--snapshot", snapshotPath,
  ...process.argv.slice(2),
];
const child = spawn("surfpool", args, { stdio: "inherit", cwd: resolve(here, "..") });
child.on("error", (e) => {
  console.error(`Could not start surfpool (${e.message}). Install it from https://surfpool.run`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
