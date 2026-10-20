// Generates merchant / subscriber / puller keypairs (CLI-compatible JSON) and
// prints funding instructions. Run once.

import { createKeyPairSignerFromBytes } from "@solana/kit";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { TOKEN_MINT, ataOf } from "./common.js";

function generateSecretKey(): Uint8Array {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const out = new Uint8Array(64);
  out.set(seed, 0);
  out.set(pub, 32);
  return out;
}

function loadOrCreate(path: string): Uint8Array {
  if (existsSync(path)) {
    console.log(`${path} exists - keeping it`);
    return Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  }
  const key = generateSecretKey();
  writeFileSync(path, JSON.stringify(Array.from(key)));
  console.log(`created ${path}`);
  return key;
}

const roles = ["merchant", "subscriber", "puller"] as const;
const signers = Object.fromEntries(
  await Promise.all(roles.map(async (r) => [r, await createKeyPairSignerFromBytes(loadOrCreate(`./${r}-wallet.json`))]))
);

console.log("\n=== Funding (devnet) ===\n");
for (const r of roles) {
  console.log(`${r.padEnd(10)} ${signers[r].address}`);
  console.log(`  solana airdrop 1 ${signers[r].address} -u devnet`);
}
console.log(`\nSubscriber also needs the plan token (mint ${TOKEN_MINT}):`);
console.log(`  https://faucet.circle.com -> ${signers.subscriber.address}`);
console.log(`\nMerchant receiving ATA (create it before collecting):`);
console.log(`  ${await ataOf(signers.merchant.address)}`);
console.log(`  spl-token create-account ${TOKEN_MINT} --owner ${signers.merchant.address} -u devnet --fee-payer ./merchant-wallet.json`);
