# x402 on Devnet - Lab Solution

Minimal x402 payment flow on Solana devnet with no facilitator and no x402 SDK: an Express server that quotes, verifies, and settles SPL token payments, and a Node client that pays automatically. Includes the JWT session improvement (lab step 3) - one verified payment grants 5 minutes of access without further payments.

Demonstration code - unaudited, not production ready.

## Files

| File | Purpose |
|------|---------|
| `config.ts` | Shared settings: RPC, mint, price, JWT TTL. Lab step 2 (different token and price) happens here. |
| `setup.ts` | Generates `server-wallet.json` and `client-wallet.json`, prints funding instructions. |
| `server.ts` | The x402 server: 402 challenge, full verification pipeline, settlement, JWT issuance. |
| `client.ts` | The x402 client: quote, build + sign transfer, retry with `X-PAYMENT`, save and reuse the JWT. |

## Setup

```bash
npm install

# 1. Generate keypairs and print funding instructions
npm run setup

# 2. Fund the client wallet (from the setup output):
#    - SOL for fees:   solana airdrop 2 <CLIENT_ADDRESS> -u devnet
#    - devnet USDC:    https://faucet.circle.com -> send to <CLIENT_ADDRESS>
```

## Run

```bash
# Terminal 1
npm run server

# Terminal 2 - full payment flow (402 -> sign -> X-PAYMENT -> 200 + JWT)
npm run client

# Terminal 2 again - within 5 minutes: served via JWT, no payment
npm run client:jwt
```

To pay from an existing wallet (e.g. the Solana CLI default) instead of the generated one:

```bash
WALLET_PATH=~/.config/solana/id.json npm run client
```

The wallet needs devnet SOL for fees and devnet USDC (from https://faucet.circle.com). `SERVER_WALLET_PATH` overrides the recipient wallet the same way.

## What to observe in the logs

1. **The 402 challenge.** The first request returns `402` with `PaymentRequirements`: scheme, amount, mint, and the recipient token account.
2. **The client signs but does not submit.** The signed transaction travels to the server inside the base64 `X-PAYMENT` header; the server broadcasts it. This gives the server control over settlement timing relative to serving content.
3. **The verification pipeline** (server logs, in order):
   - instruction bytes decoded and checked against the quoted destination and amount - client-claimed fields are never trusted
   - `simulateTransaction` before any broadcast
   - submit + wait for `confirmed` commitment - duplicate signatures are rejected by the chain, so proofs cannot be replayed
   - `preTokenBalances` / `postTokenBalances` checked on the confirmed transaction - the amount actually received is the ground truth
4. **The JWT session.** The 200 response includes `sessionToken`. `npm run client:jwt` presents it as `Authorization: Bearer` and is served with no payment until it expires.

## Lab steps mapped to the code

| Lab step | Where |
|----------|-------|
| 1. Run and trace the full flow | `npm run server` + `npm run client`, follow both logs |
| 2. Different SPL token and price | `config.ts` - `TOKEN_MINT`, `TOKEN_DECIMALS`, `PRICE_BASE_UNITS` |
| 3. JWT for repeated access | `server.ts` (`issueSessionToken` / `verifySessionToken`), `client.ts` (`--reuse-jwt`), TTL in `config.ts` |

## Checkpoint answers

1. **Why does the client signs but does not submit the transaction?** The server controls when settlement happens relative to serving the content, and the flow stays within the x402 standard (the server or its facilitator broadcasts). A Solana-specific variant where the client submits and sends only the signature survives connection loss, but deviates from the spec.
2. **Why verify instruction bytes?** Any field the client sends in headers or JSON can lie. The decoded transfer instruction - destination account and u64 amount - is what will actually execute.
3. **Why simulate first?** A transaction that fails simulation would waste a broadcast and can never settle; rejecting it early with a 402 keeps the flow clean.
4. **When to add a facilitator?** When you do not want RPC infrastructure, keypair management, or submission logic on the resource server - at the cost of a single point of failure (facilitator wallet running dry, service degradation) and a trust dependency on its verification.