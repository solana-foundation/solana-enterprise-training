# `anchor-mmf` — Tokenized Money-Market Fund (MMF) reference

A Solana-native reference implementation of a tokenized money-market fund
(MMF), modelling the compliance and lifecycle logic an institutional RWA
issuer needs: role-based access control, sRFC-37 Token ACL gating, a global
pause, maker/checker timelocks, rate-limited transfers, and operator-level
seizure powers.

It is written as the "handwritten Anchor" version — every account, seed,
and CPI is explicit — so it can be read top to bottom as teaching material
for Module 5 (RWAs on Solana).

## Architecture

Two in-workspace programs, plus two external sRFC-37 programs for gating:

```
┌───────────────────────┐          ┌──────────────────────────┐
│      mmf_admin        │          │    mmf_transfer_hook     │
│   (issuer + state)    │          │    (rate-limit guard)    │
│                       │          │                          │
│  Config PDA           │          │  RateLimitConfig PDA     │
│  Role PDAs            │          │  RateLimit PDAs          │
│  TimeLock PDAs        │          │  caps outflow per owner  │
│  mint/burn/force_*    │          │  per rolling window      │
└───────────────────────┘          └──────────────────────────┘
         ▲                                       ▲
         │ is mint authority +                   │ is transfer hook
         │ permanent delegate                    │
         └───────────────┬───────────────────────┘
                         │
                ┌────────┴────────┐
                │  MMF mint       │   Token-2022, 4 decimals
                │  (Token-2022)   │   TransferHook → mmf_transfer_hook
                │  default-frozen │   PermanentDelegate → Config PDA
                │  + Pausable     │   DefaultAccountState = Frozen
                └────────┬────────┘   Pausable (pause authority = Config PDA)
                         │ freeze authority delegated to
                         ▼
          ┌───────────────────────────────┐   sRFC-37 Token ACL
          │  Token ACL  (TACLkU6Ci…)      │   - MintConfig PDA holds
          │  + ABL gate (GATEzzqx…)       │     freeze authority
          │                               │   - permissionless thaw,
          │  allow/block list + thaw      │     gated by the ABL list
          └───────────────────────────────┘
```

**Gating is the external sRFC-37 Token ACL, not this program.** The mint is
default-frozen, so a fresh ATA cannot transact until it is thawed. Thawing is
permissionless but gated by the ABL allow/block list. At bootstrap the admin
(the mint's initial freeze authority) hands freeze authority to the Token ACL
`MintConfig` via `create_config`, enables permissionless thaw, and points the
mint at the gate. `mmf_admin` never calls into Token ACL — it is purely the
token issuer. To sideline a holder, add them to a Block-mode list.

The transfer hook is a separate program for **re-entrancy hygiene.** `mmf_admin`
calls `transfer_checked` inside `force_transfer`, which triggers Token-2022 to
invoke the transfer hook. If the hook lived inside `mmf_admin`, that would be a
re-entrant CPI back into the running program. Keeping the hook in its own
read-only program eliminates that surface. The hook is rate-limit-only: it caps
how much can leave any one owner's account per window, ignores pause and the
allow list (both enforced elsewhere - pause by the Token-2022 Pausable
extension, gating by Token ACL), and skips permanent-delegate (force) transfers
so a compliance seizure is never throttled.

## Mapping from an EVM Diamond

The design mirrors a common EVM pattern: an ERC-2535 "Diamond" contract
that exposes one address with many facets.

| EVM facet | Solana equivalent |
|---|---|
| `ERC20Facet` (balances, transfers) | Token-2022 mint itself |
| `AccessControlFacet` | `state::Role` PDAs + `set_role` ix |
| Allow/block list compliance | external sRFC-37 Token ACL + ABL gate (default-frozen mint + gated permissionless thaw) |
| `PauseFacet` | Token-2022 **Pausable** extension + `set_paused` ix (immediate, role-gated, protocol-level halt of all transfer/mint/burn) |
| `MintBurnFacet` | `mint_mmf` / `burn_mmf` ix |
| Account freeze (block a holder) | **client-side** Token ACL `Freeze` / ABL block list (freeze authority lives in Token ACL, not this program) |
| Implicit operator authority | `force_transfer` / `force_burn` ix (timelocked), backed by the mint's `PermanentDelegate` extension |
| `diamondCut` upgradeability | BPF upgrade authority on both programs (e.g. a Squads multisig) |

The `Config.version` field lets off-chain services reconcile on-chain state
against the fund's books between upgrades.

## Roles

Defined in `mmf_admin::state::role`:

- `ROLE_MINTER` — can mint (subscription bridge) and burn (redemption bridge).
- `ROLE_PAUSER` — can pause/resume the mint (Pausable extension), immediately.
- `ROLE_COMPLIANCE_DELEGATE` — can `force_transfer` and `force_burn` from any
  holder ATA, via the mint's `PermanentDelegate` extension. Used for sanctions
  seizure, recovery of misdirected funds, and wind-down. Every seizure emits an
  `AssetSeizure` audit event via `emit_cpi!`, so the action leaves a durable,
  indexable record.
- `ROLE_RESPONDER` — approves/rejects timelock proposals (maker/checker).

**Two speeds, no break-glass role.** The privileged actions split by how
time-critical they are:

- **Immediate (role only):** `set_paused` and freezing a holder. These are the
  circuit breakers - you must be able to halt the mint, or stop one bad actor,
  in the same block. Dual-control comes from the authorizing key being a
  multisig, not from an on-chain delay.
- **Timelocked (maker/checker):** `set_role`, `burn_mmf`, `force_transfer`,
  `force_burn`. These move value or change permissions, are never urgent (the
  target is already frozen if it was an incident), and require a proposer with
  the action's role plus a distinct `ROLE_RESPONDER` to accept, then a delay.

There is no emergency/break-glass role that bypasses a timelock.

**Genesis roles.** Because every timelocked action needs two distinct keys (a
proposer with the action's role + a responder), a clean slate cannot bootstrap
itself. So `initialize` seeds an operable starting set directly: the deployer
receives the operator roles (`ROLE_MINTER`, `ROLE_PAUSER`,
`ROLE_COMPLIANCE_DELEGATE`) and a second `responder` key receives
`ROLE_RESPONDER`. In production the admin should hand each operator role to a
dedicated key and revoke its own, via the normal timelocked `set_role`.

Compliance allow/block listing is **not** a role here — it lives in the external
ABL gate program, whose list authority is set client-side at bootstrap.

The `Config.admin` field is a single pubkey that grants/revokes roles and
can rotate itself. In production it should be a multisig.

## Freezing a holder

Freezing a single account is the instant "block this wallet" lever - the
counterpart to thawing during onboarding. **It is deliberately not an
`mmf_admin` instruction**, because the mint's Token-2022 *freeze authority* was
handed to the Token ACL `MintConfig` at bootstrap (that is what makes
permissionless thaw possible). The issuer therefore freezes/thaws **client-side
through Token ACL**, which owns the authority:

- **Freeze (authority path):** the recorded `MintConfig` authority (the admin
  key set during `create_config`) calls Token ACL's `Freeze`, which CPIs
  Token-2022 `FreezeAccount` signed by the `MintConfig` PDA. A frozen account
  can neither send nor receive until it is thawed. (Exercised in the e2e test.)
- **Block-list (gate path):** add the holder to an ABL **Block**-mode list, so
  they can no longer self-thaw and `freeze_permissionless` will freeze them.
- **Thaw / recover:** re-approve on the allow list and call
  `thaw_permissionless`, or use Token ACL's authority `Thaw`.

This keeps `mmf_admin` a pure issuer: it mints, burns, pauses, and seizes via
the permanent delegate, while account-level freeze/thaw lives with the
gating layer that owns the freeze authority. (If you wanted freeze to be an
on-chain, role-gated `mmf_admin` instruction, you would first hand the Token
ACL `MintConfig` authority to the `Config` PDA and have the program CPI Token
ACL's `Freeze` - a deliberate trade-off this example does not take.)

## Onboarding flow

```
mmf_admin.initialize                       (mint: default-frozen, freeze_auth = admin)
token_acl.create_config(gating = GATE)     (delegates freeze authority to MintConfig)
token_acl.toggle_permissionless([0,1])     (enable permissionless thaw)
gate.create_list(Allow, seed)              (admin = list authority)
gate.setup_extra_metas(list_config)        (binds the list to the mint for thaw)
gate.add_wallet(holder)                    (allowlist the holder)
create holder ATA                          (frozen by default)
token_acl.thaw_permissionless(holder ATA)  (gate validates -> ATA thawed)
hook.initialize_rate_config / _rate_limit  (per-mint cap + per-owner counter)
mmf_admin.mint_mmf                          (now succeeds)
transfer                                    (hook enforces the rate limit)
```

## Build and test

```bash
anchor build          # or: cargo build-sbf
cargo test            # pure-logic unit tests (timelock + rate-limit)
cargo test -p mmf-admin --test test_e2e_token_acl
                      # full litesvm flow against the real Token ACL + ABL .so
```

## Layout

```
programs/
├── anchor-mmf/              # crate name: mmf-admin (the issuer)
│   ├── src/
│   │   ├── lib.rs
│   │   ├── constants.rs
│   │   ├── error.rs
│   │   ├── state.rs           # module root
│   │   ├── state/
│   │   │   ├── config.rs
│   │   │   ├── role.rs
│   │   │   └── timelock.rs
│   │   ├── instructions.rs    # module root
│   │   └── instructions/
│   │       ├── initialize.rs
│   │       ├── set_role.rs
│   │       ├── pause.rs
│   │       ├── mint_mmf.rs
│   │       ├── burn_mmf.rs
│   │       ├── force_transfer.rs
│   │       ├── force_burn.rs
│   │       ├── create_timelock_proposal.rs
│   │       └── respond_timelock_proposal.rs
│   └── tests/
│       ├── test_initialize.rs        # compile-time smoke test
│       ├── test_e2e_token_acl.rs     # litesvm end-to-end flow
│       └── fixtures/                 # vendored token_acl.so + gate .so
└── mmf-transfer-hook/
    └── src/
        ├── lib.rs
        ├── constants.rs
        ├── error.rs
        ├── state/
        │   ├── mod.rs
        │   └── rate_limit.rs
        └── instructions/
            ├── mod.rs
            ├── init_extra_account_meta.rs
            ├── initialize_rate_config.rs
            ├── initialize_rate_limit.rs
            ├── set_rate_limit.rs
            └── transfer_hook.rs
```

## Intentional gaps vs production

- **Squads multisig.** `Config.admin`, the gate list authority, and both BPF
  upgrade authorities should all be a custodian-co-signed multisig.
- **Timelock coverage.** The timelock `action_data` binding is exercised by the
  unit tests; wiring every privileged path through it is left as an exercise.
- **Tests.** The litesvm end-to-end test exercises the real Token ACL + ABL
  programs from vendored `.so` fixtures; a production suite would add adversarial
  cases (block-listed thaw, re-freeze, cap edge cases).
