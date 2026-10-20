# Subscription Plan - Lab Example

End-to-end subscription plan lifecycle on the Solana **Subscriptions Delegation Program** (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`), using `@solana/kit` and the `@solana/subscriptions` plugin client.

Three roles: **merchant** (owns the plan), **subscriber** (pays), **puller** (the merchant's collector key, listed on the plan).

| Script | Signer | What it does |
|---|---|---|
| `setup.ts` | - | Generates the three keypairs, prints funding instructions |
| `1-create-plan.ts` | merchant | Publishes the plan: amount, period, destinations, pullers |
| `2-subscribe.ts` | subscriber | Initializes the Subscription Authority (once per user+mint) and subscribes |
| `3-collect.ts` | puller | Collects one period; classifies failures (not-yet / dunning / compliance / stopped / bug) |
| `4-cancel.ts` | subscriber (+ merchant with `--now`) | Cancel at period end, or dual-signed immediate cancel |
| `5-revoke.ts` | subscriber | Closes the subscription PDA after expiry; `--close-authority` also clears the delegate |

## Setup

```bash
npm install
npm run setup          # prints addresses + funding commands
```

Fund per the output: SOL to all three (airdrop), the plan token to the subscriber (devnet USDC from faucet.circle.com), and create the merchant's receiving token account.

Environment overrides: `RPC_URL`, `TOKEN_MINT`, `PLAN_ID`, and `MERCHANT_WALLET` / `SUBSCRIBER_WALLET` / `PULLER_WALLET` (e.g. `~/.config/solana/id.json`).

## Run the lab

```bash
npm run create-plan
npm run subscribe
npm run collect          # collected
npm run collect          # -> not-yet (PeriodNotElapsed) - the schedule is on-chain
npm run cancel           # cancel at period end
npm run collect          # still succeeds until expiry
# ...after expiry:
npm run revoke -- --close-authority
```

Things to look at along the way:

- After `subscribe`, inspect the subscriber's token account (`spl-token account-info`): the **delegate is the Subscription Authority PDA**, not the merchant. One delegate, arbitrarily many authorizations behind it.
- The second `collect` in the same period fails in the *program*, not in the collector. The collector's job is to classify, not to enforce.
- `cancel --now` is bound to `currentPeriodStartTs` at signing; if the period rolls first, the program rejects it (`StaleSubscriptionApproval`) - the action-binding pattern from Module 5.

## Notes

- The plugin client resolves transfer-hook accounts automatically for Token-2022 mints with hooks. Mints with PermanentDelegate, ConfidentialTransfer, TransferFee, Pausable, NonTransferable, or MintCloseAuthority are rejected by the program (README Section 8).
- `lab-state.json` carries PDAs between scripts; delete it to start over.
- Pinned versions: `@solana/kit ^7.1`, plugins `0.17.0`, `@solana/subscriptions 0.5.0`, `@solana-program/token 0.15.0` - these peer-match. Newer kit-plugin releases require kit 8.
