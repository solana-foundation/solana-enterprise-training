# TBIL - A Tokenized T-Bill Fund Share with Zero Custom Code

A tokenized money-market / T-bill fund share built **entirely from Token-2022
extensions**, driven from TypeScript with [@solana/kit](https://github.com/anza-xyz/kit).
No Anchor, no on-chain program of our own - every compliance feature is mint
configuration.

This is the counterpoint to [anchor-mmf](../anchor-mmf/): that example shows
what still *requires* custom programs (rate limiting, maker/checker timelocks);
this one shows how far you get before writing any Rust at all.

## The four extensions

| Extension | RWA role | EVM equivalent |
|---|---|---|
| **DefaultAccountState = Frozen** | Allowlist onboarding: every token account is born frozen; KYC approval = the issuer thawing it | Bespoke allowlist checks in `transfer()` |
| **PermanentDelegate** | Seizure, force-transfer, transfer-agent redemption | Issuer-privileged `transferFrom` / `burnFrom` overrides |
| **MetadataPointer + TokenMetadata** | Name, symbol, prospectus URI on the mint itself | Off-chain metadata or a registry contract |
| **ScaledUiAmount** | Daily NAV accrual: one multiplier update rescales every displayed balance; raw balances never change | Rebasing tokens (stETH-style) or wrapper contracts |

Two emergent guarantees worth teaching:

- **You cannot mint to an un-onboarded investor** - their ATA is still frozen
  and `MintTo` fails. Compliance is enforced by account state, not by
  application code remembering to check.
- **The rule applies to everyone, including the issuer** - the treasury's own
  ATA is born frozen and must be thawed too (see `05-seize.ts`).

## Lifecycle scripts

Each step is one command; addresses flow between steps via `.state.json`
(gitignored - the demo issuer key lives there in plain text, which is fine
for a throwaway demo and never for production).

| # | Command | What happens |
|---|---|---|
| 1 | `npm run create-tbill` | Create the mint with all four extensions in one atomic transaction |
| 2 | `npm run onboard-investor` | Create the investor's ATA (born frozen) + thaw it = KYC approval |
| 3 | `npm run issue` | Mint 100,000 TBIL against an off-chain subscription |
| 4 | `npm run nav-update` | NAV moves to 1.0004 - watch `ui` change while `raw` doesn't |
| 5 | `npm run seize` | Court order: permanent delegate moves 25,000 TBIL to treasury, no investor signature |
| 6 | `npm run redeem` | Transfer agent burns the remaining position |

## Run it

```bash
npm install

# local validator (recommended for class - fast, no faucet limits)
solana-test-validator --reset   # in another terminal
export RPC_URL=http://127.0.0.1:8899

npm run all     # or run the six steps one by one
```

Defaults to devnet if `RPC_URL` is unset (devnet's faucet can be
rate-limited). ScaledUiAmount needs a recent Token-2022; any current Agave
test validator (2.x+) and devnet/mainnet all support it.

To start over: delete `.state.json` and run from step 1.

## What this example deliberately does NOT cover

- **Transfer restrictions between approved holders** (amount caps, velocity
  rules) - needs a transfer hook: see `anchor-mmf`'s rate-limit hook.
- **Dual control / maker-checker on privileged actions** - here one issuer
  key can seize; `anchor-mmf` shows the timelock + action-binding pattern.
- **Key management** - the issuer key in `.state.json` stands in for an HSM
  or MPC signer.

The line between the two examples *is* the lesson: Token-2022 gives you the
asset's compliance primitives; custom programs are only needed for policy.
