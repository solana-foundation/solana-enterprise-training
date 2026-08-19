/**
 * mint-tokens.ts - Create an SPL token mint and mint tokens with @solana/kit.
 *
 * Demonstrates the four steps behind every fungible token launch:
 *
 *   1. Create the mint account (System Program allocates + funds it)
 *   2. Initialize it as a mint (Token Program writes decimals + authorities)
 *   3. Create the recipient's Associated Token Account (ATA)
 *   4. Mint tokens into that ATA
 *
 * All four instructions are batched into a single transaction, so the
 * whole launch is atomic - either the token exists fully set up, or
 * nothing happened at all.
 */

import {
  airdropFactory,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMintInstruction,
  getMintSize,
  getMintToInstruction,
} from "@solana-program/token";

// ---------------------------------------------------------------------------
// Setup: RPC connection and a funded payer
// ---------------------------------------------------------------------------

const httpUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
// Derive the websocket endpoint; a local test validator serves it on port 8900.
const wsUrl = httpUrl
  .replace("https://", "wss://")
  .replace("http://", "ws://")
  .replace(":8899", ":8900");

const rpc = createSolanaRpc(httpUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const airdrop = airdropFactory({ rpc, rpcSubscriptions });

// The payer is also the mint authority and the token recipient here.
// In production these would usually be three different keys.
const payer = await generateKeyPairSigner();
console.log(`Payer / mint authority: ${payer.address}`);

console.log("Requesting airdrop...");
await airdrop({
  recipientAddress: payer.address,
  lamports: lamports(1_000_000_000n), // 1 SOL
  commitment: "confirmed",
});

// ---------------------------------------------------------------------------
// Build the instructions
// ---------------------------------------------------------------------------

const DECIMALS = 6;
const AMOUNT = 1_000n * 10n ** BigInt(DECIMALS); // 1,000 whole tokens

// Unlike EVM ERC-20s, a mint is not a contract you deploy - it is a plain
// account owned by the (already deployed) Token Program. The mint keypair
// signs because creating an account at its address requires its signature.
const mint = await generateKeyPairSigner();
console.log(`Mint: ${mint.address}`);

const mintSpace = BigInt(getMintSize());
const mintRent = await rpc.getMinimumBalanceForRentExemption(mintSpace).send();

// The ATA address is derived, not chosen: one canonical token account
// per (owner, mint) pair.
const [ata] = await findAssociatedTokenPda({
  owner: payer.address,
  mint: mint.address,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});
console.log(`Recipient ATA: ${ata}`);

const instructions = [
  // 1. Allocate the mint account and assign it to the Token Program.
  getCreateAccountInstruction({
    payer,
    newAccount: mint,
    space: mintSpace,
    lamports: mintRent,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  }),
  // 2. Write the mint's state: decimals and who may mint / freeze.
  getInitializeMintInstruction({
    mint: mint.address,
    decimals: DECIMALS,
    mintAuthority: payer.address,
    freezeAuthority: payer.address,
  }),
  // 3. Create the recipient's ATA (idempotent: no-op if it already exists).
  getCreateAssociatedTokenIdempotentInstruction({
    payer,
    owner: payer.address,
    mint: mint.address,
    ata,
  }),
  // 4. Mint tokens into it. Only the mint authority can do this.
  getMintToInstruction({
    mint: mint.address,
    token: ata,
    mintAuthority: payer,
    amount: AMOUNT,
  }),
];

// ---------------------------------------------------------------------------
// Sign, send, confirm
// ---------------------------------------------------------------------------

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(payer, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions(instructions, tx),
);

const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
assertIsTransactionWithBlockhashLifetime(signedTransaction);
await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

console.log(`Transaction: ${getSignatureFromTransaction(signedTransaction)}`);

// ---------------------------------------------------------------------------
// Verify: read the mint and token account back from the chain
// ---------------------------------------------------------------------------

const mintAccount = await fetchMint(rpc, mint.address);
const tokenAccount = await fetchToken(rpc, ata);

console.log(`Mint supply: ${mintAccount.data.supply} (decimals: ${mintAccount.data.decimals})`);
console.log(`ATA balance: ${tokenAccount.data.amount}`);
