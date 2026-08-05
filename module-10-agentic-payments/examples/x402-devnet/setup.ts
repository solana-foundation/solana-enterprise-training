// Generates the two keypairs used by the example (server recipient + client
// payer) and prints funding instructions. Run once before starting the lab.

import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { TOKEN_MINT } from "./config.js";

function loadOrCreate(path: string): Keypair {
  if (existsSync(path)) {
    console.log(`${path} already exists - keeping it`);
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(data));
  }
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`created ${path}`);
  return kp;
}

const server = loadOrCreate("./server-wallet.json");
const client = loadOrCreate("./client-wallet.json");

console.log("\n=== Funding instructions (devnet) ===\n");
console.log(`Server (recipient) address: ${server.publicKey.toBase58()}`);
console.log(`Client (payer) address:     ${client.publicKey.toBase58()}\n`);
console.log("1. Airdrop SOL to the CLIENT (pays transaction fees):");
console.log(`   solana airdrop 2 ${client.publicKey.toBase58()} -u devnet\n`);
console.log("2. Get devnet USDC to the CLIENT from https://faucet.circle.com");
console.log(`   (send to ${client.publicKey.toBase58()})\n`);
console.log("Recipient token account (ATA) the server will quote:");
console.log(
  `   ${getAssociatedTokenAddressSync(TOKEN_MINT, server.publicKey).toBase58()}`
);
console.log(
  "\nThe client creates this ATA automatically on first payment if needed."
);
