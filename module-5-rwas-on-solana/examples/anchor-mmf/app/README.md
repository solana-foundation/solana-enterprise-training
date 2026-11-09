# MMF Console

A teaching console for the anchor-mmf example. You switch between the fund's
actors, run every lifecycle step against the real programs on a local
validator, and each transaction opens in an inspector that shows every
account, the seeds behind each PDA, which programs ran and the logs. The
screens also let you trigger each rejection on purpose.

Localnet only. The personas are burner keypairs written to
`public/localnet.json` (gitignored), so never point it at a real cluster.

## Run it

Needs Node 22+, Yarn 1, the Anchor CLI and [Surfpool](https://surfpool.run).

```bash
cd module-5-rwas-on-solana/examples/anchor-mmf
anchor build                 # the console reads target/idl and target/types

cd app
yarn install
yarn localnet                # terminal 1: offline Surfpool with all 5 programs
yarn bootstrap               # terminal 2: create the fund and the personas
yarn dev                     # http://localhost:5173
```

`yarn localnet` works without network access. It writes the two MMF programs
from `target/deploy` and the vendored Token ACL, ABL gate and Token-2022
fixtures (`programs/anchor-mmf/tests/fixtures`) into a Surfpool account
snapshot, so every program sits at its real address.

There is one fund per deployment (the Config PDA has a fixed seed). For a
fresh fund, stop the localnet, start it again and rerun `yarn bootstrap`.

## What bootstrap does

The same steps as tests 1-4 in `programs/anchor-mmf/tests/test_e2e_token_acl.rs`:

1. `mmf_admin::initialize`: default-frozen mint, Config, genesis roles (Admin
   gets MINTER, BURNER, PAUSER and COMPLIANCE_DELEGATE; Responder gets RESPONDER).
2. Hook setup: extra-account-meta list and the per-mint rate-limit config
   (100 MMF per hour).
3. Token ACL: `create_config` takes over the freeze authority, then
   permissionless thaw is enabled.
4. ABL gate: an Allow-mode list, bound to the mint for thaw.

It also airdrops 100 SOL to each persona. It doesn't onboard any holders,
because that's the first thing the console demonstrates.

## Screens

| Screen | Teaches | Rejections to trigger |
|---|---|---|
| Dashboard | State lives in accounts: Config, Role PDAs, mint extensions, token accounts | - |
| Onboarding | Allowlist, create the frozen account, permissionless thaw, rate-limit account, mint | `AccountFrozen`, gate rejection |
| Timelock | Maker/checker with action binding, plus fast-forwarding the clock | `TimelockNotReady`, `TimelockActionMismatch`, missing RESPONDER role |
| Transfers | The hook runs as a CPI on every transfer and enforces the window cap | `RateLimitExceeded` |
| Controls | Pause, sideline a holder through Token ACL, permissioned burn, rate-limit settings | `MintPaused`, gate rejection after removal, plain `BurnChecked` |

Every action button signs as the persona that the step needs, and switches the
top bar to that persona. When a different persona is active, a second
"Try as ..." button runs the same instruction with that key, so the class can
watch the program refuse it.

**Fast-forward clock** uses Surfpool's `surfnet_timeTravel` cheatcode. The
programs only read `Clock::unix_timestamp`, so on a real cluster the only way
past a timelock is to wait.

## Flow example

1. Dashboard: a freshly bootstrapped fund with zero supply.
2. Onboarding: **Mint 10 to Outsider** fails with `AccountFrozen`.
3. Onboard Holder A, Holder B and the Treasury (Admin), then mint 200 to A.
   Open the thaw in the inspector: `mmf_admin` is not in it.
4. Transfers: A sends 60 to B, then 50 more: `RateLimitExceeded`.
5. Timelock: propose a 120 MMF force transfer from A to the Treasury. With
   Admin active, **Try as Admin** on Approve fails because Admin has no
   RESPONDER role. Approve as Responder.
6. **Execute now** fails with `TimelockNotReady`. Fast-forward, then **Execute
   to ... instead** fails with `TimelockActionMismatch`. **Execute** succeeds,
   above the rate cap.
7. Controls: pause, try a transfer (`MintPaused`), resume.
8. Sideline Holder B: freeze, then self-thaw (it works, because B is still
   allowlisted), remove from the allow list, freeze again, self-thaw (refused).
9. Burn 50 from the Treasury with `permissioned_burn`, then try a plain
   `BurnChecked` (refused).

## Smoke test

`yarn smoke` runs the same demo headlessly through the console's own
instruction builders, error decoder and state loader, and asserts every
expected rejection by name. Run it against a freshly bootstrapped localnet.
It uses up the fund, so restart the localnet and bootstrap again before a
class.

## Layout

```
scripts/
  localnet.ts       snapshot the 5 programs, start Surfpool offline
  bootstrap.ts      create the fund, write public/localnet.json
  smoke.ts          the class demo as an integration test
src/lib/
  constants.ts      program ids, roles, timelock delays, personas
  names.ts          PDA derivation (records seeds for the inspector) and address names
  programs.ts       Anchor clients from target/idl
  instructions.ts   every instruction: Anchor for mmf_admin and the hook, hand-built
                    for Token-2022, Token ACL and the ABL gate
  chain.ts          send, chain clock, surfnet_timeTravel
  errors.ts         turns logs into a named error with a hint
  state.ts          loads and decodes the whole fund
src/screens/        one file per screen
src/components/     shared UI and the inspector
```

Token ACL and the ABL gate are hand-built because their published clients
target `@solana/kit`, while Anchor's TypeScript client uses web3.js v1. The
discriminators and account orders match `test_e2e_token_acl.rs` and the
generated clients in `solana-foundation/token-acl` and
`solana-foundation/token-acl-gate`.
