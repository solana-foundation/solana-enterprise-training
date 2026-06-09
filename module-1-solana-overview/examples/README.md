# Module 1 — Hands-On Examples

*Inspect real on-chain state* with the Solana CLI and a block explorer.

Exact numbers will differ from what's printed below as these outputs are **illustrative**, aimed to show the *shape* of the result and what to look at. 
You can cross-check addresses and values on an explorer ([Solana Explorer](https://explorer.solana.com), [Solscan](https://solscan.io));

## Prerequisites

```bash
solana --version          # confirm the CLI is installed
```

These examples read from **mainnet** so you're looking at real data. Rather than changing the CLI config, we will use `--url mainnet-beta` or `--url devnet` to target either mainnet or devnet cluster.

Reference addresses that can be used (all mainnet, verifiable on any explorer):

| Thing | Address |
|---|---|
| System Program | `11111111111111111111111111111111` |
| SPL Token Program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Token-2022 Program | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| Upgradeable BPF Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| USDC Mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

---

## Example 1 — Anatomy of an Account

**Everything on Solana is an account** — wallets, token balances, mints, even programs themselves. 
They all share one struct (`AccountInfo`). Below we have *different* kinds of account and they have the *same* fields.

### 1a. A token mint (USDC mint)

```bash
solana account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --url mainnet-beta
```

Illustrative output:

```
Public Key: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
Balance: 0.00410272 SOL
Owner: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
Executable: false
Rent Epoch: 18446744073709551615
Length: 82 (0x52) bytes
...
```

Things to point out:

- **`Owner` is the Token Program, not USDC's "issuer."** On Solana the *owner* of an account is the program allowed to mutate its data. The mint's data is owned and managed by the Token Program. There is no "USDC contract" — USDC is just *data* sitting in an account that the generic Token Program knows how to interpret.
- **`Length: 82 bytes`** — a classic SPL mint is exactly 82 bytes. A classic SPL mint means a regular SPL token owned by the Token Program, not the Token 2022 Program.
- **`Rent Epoch: 18446744073709551615`** — that's `u64::MAX` (maximum value of a 64bit unsigned integer). It means "never collect rent": the account is rent-exempt.

### 1b. A program (Token Program)

```bash
solana account TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --url mainnet-beta
```

The field that matters here is **`Executable: true`** that distinguishes a program from plain data. For an *upgradeable* program, the program account is just a thin pointer; the bytecode lives in a **separate ProgramData account**.

```bash
# pick any upgradeable program id, e.g. a deployed app program
solana program show <PROGRAM_ID> --url mainnet-beta
```

Illustrative output:

```
Program Id: <PROGRAM_ID>
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: <DIFFERENT_ADDRESS>
Authority: <UPGRADE_AUTHORITY_PUBKEY>
Last Deployed In Slot: 301234567
Data Length: 284512 (0x457a0) bytes
Balance: 3.96 SOL
```

**EVM contrast:** an EVM contract is code *and* storage merged at one address. Here they're deliberately split (code in one account, every piece of state in *its own* account).

---

## Example 2 — "Where Does My Balance Live?"

*"You hold 1,000 USDC. Where is that number stored?"* In EVM, it is stored in the USDC contract. On Solana, it is stored in a separate account from the token program.

**EVM:** Your balance is the *contract's* state. The contract is one account holding everyone's balances.

**Solana:** your USDC balance lives in a **token account that is keyed to you**, separate from the mint (onchain asset/token) and separate from every other holder's account. The Token Program owns its data (so only it can move tokens), but it's *your* slot of state, with its own address and its own rent deposit.

Grab any USDC holder's token account from the explorer's "Holders" tab and inspect it:

```bash
solana account <SOME_USDC_TOKEN_ACCOUNT> --url mainnet-beta
```

```
Owner: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
Length: 165 (0xa5) bytes          # classic SPL token account size
...
```

Note the **165 bytes** (vs. the mint's 82) and that the `Owner` is the Token Program. Decode the data and you'd find: the mint it belongs to, the wallet that owns the tokens, and the amount.

The address of *your* USDC account isn't random. It's the **Associated Token Account (ATA)**, a PDA derived from `(your wallet, token program, mint)`. So the answer to "where does my balance live" is: *at a deterministic address derived from who I am and which token it is*.

---

## Example 3 — Dissect a Real Transaction

Find a recent transaction on the explorer — a Jupiter swap is a great specimen because it composes several programs in one atomic shot. Copy its signature and run:

```bash
solana confirm -v <TRANSACTION_SIGNATURE> --url mainnet-beta
```

Walk the verbose output and you will be able to find:

- **The accounts array** — *every* account the transaction touches is listed up front, each flagged writable/readonly and signer/non-signer. **This is the thing EVM has no analog for.** Because accounts are declared in advance, the runtime knows what each transaction will read and write *before* executing it. This lets Solana run non-conflicting transactions in parallel (Sealevel). 
- **Multiple instructions / inner instructions** — one program calling another (a CPI). A swap might invoke the DEX program, which invokes the Token Program twice. That nesting *is* composability, and the inner calls are where `invoke_signed` happens (a PDA "signing" by virtue of the program's ID, not a keypair).
- **Compute units consumed** and **fee** — note the fee is `5000 lamports × signatures` plus any priority fee (`micro-lamports per CU × CU limit`).

**EVM contrast:** an EVM transaction discovers what it touches *as it runs*. A Solana transaction must *declare* it. More upfront friction for the developer but, in exchange, the runtime gets parallelism for free. Solana natively allows multiple instructions to be batched into a single transaction.

---

## Example 4 — Rent

First, the Rent calculation. Works on any cluster:

```bash
solana rent 82      # a mint
solana rent 165     # a token account
solana rent 0       # bare account (no data, just the 128-byte overhead)
```

Illustrative output for `solana rent 165`:

```
Rent-exempt minimum: 0.00203928 SOL
```

The rent-exempt minimum is `lamports_per_byte_year × (128 + data_len) × 2 years`, with `lamports_per_byte_year = 3480`:

```
165 bytes →  3480 × (128 + 165) × 2 = 2,039,280 lamports = 0.00203928 SOL
 82 bytes →  3480 × (128 +  82) × 2 = 1,461,600 lamports = 0.0014616  SOL
```

The "2 years" is **just this multiplier in a one-time calculation** not a recurring charge. The SOL becomes part of the account's balance and is **returned in full when the account is closed.**

### Optional: Claim Rent back (devnet)

To *see* the refund, do a create→close cycle on devnet with free SOL. (Requires the `spl-token` CLI.)

```bash
solana airdrop 1 --url devnet                           # free devnet SOL
solana balance --url devnet                             # note it down

spl-token create-token --url devnet                     # creates a mint -> prints <MINT>
solana balance --url devnet                             # dropped by the rent deposit

spl-token create-account <MINT> --url devnet            # creates a token account for the specific mint
solana balance --url devnet                             # dropped by the rent deposit

spl-token close <MINT> --url devnet                     # close the empty token account
solana balance --url devnet                             # the deposit is back
```

The balance dips when you open the account and returns when you close it. You were never *charged*, you posted a deposit and got it back.
