// Generates the two keypairs used by the example (server recipient + client
// payer) and prints funding instructions. Run once before starting the lab.
//
// Keys are stored as 64-byte JSON arrays (seed + public key), the same format
// the Solana CLI uses, and loaded with Kit's createKeyPairSignerFromBytes.

import { createKeyPairSignerFromBytes } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { TOKEN_MINT } from "./config.js";

function b64urlToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

// Generate a CLI-compatible 64-byte secret key (32-byte seed + 32-byte pubkey)
// using Node's built-in Ed25519 support - no extra dependencies.
function generateSecretKeyBytes(): Uint8Array {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const seed = b64urlToBytes(privateKey.export({ format: "jwk" }).d!);
  const pub = b64urlToBytes(publicKey.export({ format: "jwk" }).x!);
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(pub, 32);
  return secret;
}

function loadOrCreate(path: string): Uint8Array {
  if (existsSync(path)) {
    console.log(`${path} already exists - keeping it`);
    return Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  }
  const secret = generateSecretKeyBytes();
  writeFileSync(path, JSON.stringify(Array.from(secret)));
  console.log(`created ${path}`);
  return secret;
}

const serverSigner = await createKeyPairSignerFromBytes(
  loadOrCreate("./server-wallet.json")
);
const clientSigner = await createKeyPairSignerFromBytes(
  loadOrCreate("./client-wallet.json")
);

const [recipientAta] = await findAssociatedTokenPda({
  mint: TOKEN_MINT,
  owner: serverSigner.address,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});

console.log("\n=== Funding instructions (devnet) ===\n");
console.log(`Server (recipient) address: ${serverSigner.address}`);
console.log(`Client (payer) address:     ${clientSigner.address}\n`);
console.log("1. Airdrop SOL to the CLIENT (pays transaction fees):");
console.log(`   solana airdrop 2 ${clientSigner.address} -u devnet\n`);
console.log("2. Get devnet USDC to the CLIENT from https://faucet.circle.com");
console.log(`   (send to ${clientSigner.address})\n`);
console.log("Recipient token account (ATA) the server will quote:");
console.log(`   ${recipientAta}`);
console.log(
  "\nThe client creates this ATA automatically on first payment if needed."
);
