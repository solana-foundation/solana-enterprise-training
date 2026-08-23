# Module 11: Security on Solana

## Learning Objectives

- Describe what the Solana runtime guarantees (ownership, write-locks, signature verification, no reentrancy) and what remains the program author's responsibility
- Enumerate what a malicious transaction can control and how account substitution drives most Solana exploits
- Apply the Solana program security checklist: ownership, signers, account substitution, type confusion, arithmetic, CPI safety, account closing, and PDA canonicalization
- Explain which vulnerability classes Anchor eliminates by construction, and which ones survive Anchor
- Identify token-layer risks: authority configuration, delegates, and Token-2022 extension interactions
- Draw lessons from real Solana exploits (Wormhole, Cashio, Mango Markets, Slope) and map each to a checklist item
- Design an operational security posture: upgrade authority lifecycle, key management, monitoring, and incident response levers
- Run a security development lifecycle: threat modeling, testing layers, external audits, bug bounties, and post-launch monitoring

## Topics Covered

- The Solana security model: what the runtime gives you
- Thinking like an attacker: the malicious transaction
- The program security checklist
- Anchor as a security tool - and its limits
- Token security: authorities, delegates, and extensions
- Case studies: anatomy of real Solana exploits
- Operational security: authorities, keys, and monitoring
- Economic security: oracles and market manipulation
- The audit process and security development lifecycle

## Prerequisite

Completed Module 2 (Rust Concepts & Anchor) and Module 3 (SPL Tokens), or equivalent familiarity with Anchor account constraints, PDAs, CPIs, and the token account model. 
Module 1B's security section is a compressed preview of the material covered in depth here.

## Slides

[Placeholder — Security on Solana slide deck to be created]

## Challenge

See the [challenge/](challenge/) folder for a small challenge regarding an Anchor staking vault with seven planted vulnerabilities.

---

## 1. The Solana security model: what the runtime gives you

Security analysis starts with knowing which properties are enforced by the platform and which are your job. On Solana, the runtime guarantees more than EVM does — and it is precisely the strength of these guarantees that concentrates all remaining risk in a small number of program-level mistakes.

**What the runtime enforces, always, for every program:**

- **Ownership.** Only the program that owns an account may modify its data or deduct its lamports. A program cannot write to another program's accounts, full stop.
- **Signature verification.** Every account flagged as a signer in a transaction has a verified Ed25519 signature. A program can trust `is_signer` — the runtime already checked it.
- **Write-locks and no reentrancy.** One write-lock per writable account per transaction; a program cannot appear twice in a call stack. The reentrancy guard pattern from Solidity has no purpose here (Module 1B, Section 5).
- **Balance conservation.** Lamports are conserved across an instruction; the runtime rejects instructions that mint lamports out of nothing.
- **Duplicate signature rejection.** A signed transaction can land at most once. Replay of an identical transaction is impossible at the chain level.

**What the runtime does not check — ever:**

- Whether the accounts passed to your instruction are the accounts your logic *expects*
- Whether the person who signed is *authorized* by your business rules
- Whether an account's data is of the type you think it is
- Whether your arithmetic is correct
- Whether the program you are CPI-ing into is the program you intended

Every classic Solana exploit lives in this second list. The runtime hands your program a set of accounts and a byte slice, both chosen by the caller, and executes your code. Everything else is validation you must perform.

## 2. The malicious transaction

The most useful mental exercise in Solana security: for every instruction you write, assume the caller is hostile and enumerate what they control. The answer is always the same, and it is worth memorizing:

**The attacker controls the entire transaction.** Specifically:

1. **Every account in the account list.** Where your instruction expects "the user's vault," the attacker can pass *any account in existence*: someone else's vault, an account of a different type with a convenient byte layout, an account they created and pre-filled with crafted data, or the same account twice in two different slots.
2. **All instruction data.** Amounts, indexes, flags — all attacker-chosen bytes until you validate them.
3. **The transaction context.** They choose what other instructions run before and after yours in the same transaction, and can wrap your instruction in their own program's CPI.
4. **Timing.** They can watch on-chain state and land their transaction at the most advantageous moment (e.g., around oracle updates or liquidations).

What the attacker does *not* control: signatures they do not hold, data in accounts owned by other programs, and the runtime rules from Section 1.

This framing explains why **account substitution is the center of gravity of Solana security**. On the EVM, the contract fetches its own state, so the attack surface is mostly calldata and call ordering. On Solana, the caller brings the state — so the attack surface is dominated by *which accounts got passed in*. The checklist in the next section is, at its core, a systematic answer to one question: "how do I know each account is the one I expect?"

## 3. The program security checklist

The definitive walkthrough of the vulnerability classes a Solana auditor checks, expanded from the preview in Module 1B. For each: the mistake, the exploit, and the fix.

### 3.1 Missing ownership checks

**The mistake:** reading an account's data without verifying which program owns it.

```rust
// VULNERABLE: raw AccountInfo, data trusted blindly
let vault_data = Vault::try_from_slice(&vault_info.data.borrow())?;
if vault_data.balance >= amount { /* release funds */ }
```

**The exploit:** the attacker creates their own account (owned by the System Program or their own program), fills it with bytes that deserialize into a `Vault` with a huge `balance`, and passes it in. Deserialization succeeds — bytes are bytes.

**The fix:** verify `vault_info.owner == program_id` before trusting data. In Anchor, `Account<'info, Vault>` performs this check automatically; raw `AccountInfo` / `UncheckedAccount` does not.

### 3.2 Missing signer checks

**The mistake:** verifying *which* account was passed as the authority but not that it *signed*.

```rust
// VULNERABLE: compares pubkeys, never checks the signature
if vault.authority == authority_info.key() { /* allow admin action */ }
```

**The exploit:** anyone can pass the real admin's pubkey as a non-signing account — public keys are public. The comparison passes; the admin never signed anything.

**The fix:** `Signer<'info>` in Anchor, or explicit `require!(authority_info.is_signer)`. Then bind the signer to stored state with `has_one = authority`.

### 3.3 Account substitution

**The mistake:** accounts that pass ownership and type checks but are not the *specific* account your logic requires.

**The exploit (classic pattern):** withdraw instruction takes `vault` and `destination`. The attacker passes *their own* vault as `vault`... or more subtly, the victim's vault plus checks that pass because the program never tied the vault to the signer.

**The fix — the two Anchor workhorses:**

```rust
#[account(mut, has_one = authority)]        // vault.authority must equal the signer below
pub vault: Account<'info, Vault>,
pub authority: Signer<'info>,

#[account(seeds = [b"vault", authority.key().as_ref()], bump = vault.bump)]  // or: PDA binding
pub vault: Account<'info, Vault>,
```

Every account in every instruction should be bound to either a signer, a PDA derivation, a stored pubkey (`has_one`, `address =`), or explicitly documented as intentionally unconstrained. Auditors read account structs line by line asking "what pins this account?" — you should too.

### 3.4 Type confusion and discriminators

**The mistake:** two account types with compatible byte layouts, and a program that accepts one where the other is expected.

**The exploit:** pass a `TokenAccount` where a `Config` is expected; the first 32 bytes (a mint pubkey) deserialize as `admin: Pubkey`. If the attacker can craft or find an account whose layout maps their key into the authority field, checks downstream pass.

**The fix:** Anchor prepends an 8-byte discriminator (hash of the type name) to every account and verifies it on deserialization — this class disappears under `Account<'info, T>`. Native programs must implement an equivalent tag byte themselves (compare Pinocchio's single-byte discriminator pattern from the SF cohort material).

### 3.5 Arithmetic overflow and precision

**The mistake:** unchecked arithmetic in release builds, or precision-lossy order of operations.

- Rust release builds wrap silently unless `overflow-checks = true` is set in `Cargo.toml` (Anchor templates set it; verify in yours).
- Use `checked_add` / `checked_sub` / `checked_mul` or `saturating_*` at trust boundaries regardless, so intent is explicit.
- Multiply before dividing (`amount * rate / PRECISION`, with widening to `u128` where products can overflow); division-first silently floors to zero.
- Watch casts: `as u64` truncates. Use `try_into()` with an error.

### 3.6 CPI safety: arbitrary program invocation

**The mistake:** invoking a program passed in the account list without pinning its address.

```rust
// VULNERABLE: whatever program the caller supplied gets invoked with your accounts
invoke(&ix, &[token_program_info.clone(), ...])?;
```

**The exploit:** the attacker passes their own program as `token_program`. Your program then CPIs into attacker code, handing it every account (and any PDA signature!) included in the call.

**The fix:** `Program<'info, Token>` in Anchor pins the address to the known program ID. For dynamic targets (routers, aggregators), maintain an explicit allowlist of program IDs and verify before invoking. Never sign a CPI (`invoke_signed`) into an unverified program.

### 3.7 Account closing and revival

**The mistake:** "closing" an account by transferring its lamports out but leaving its data intact.

**The exploit:** within the same transaction, the attacker refunds the rent-exempt minimum back to the account (a plain System transfer — anyone can fund any account). The account survives garbage collection with stale data marked valid, and gets replayed against your program later — e.g., a "closed" loan position that still shows collateral.

**The fix:** zero the data and overwrite the discriminator in addition to draining lamports. Anchor's `#[account(close = destination)]` does all three correctly — use it instead of manual close logic.

### 3.8 PDA bump canonicalization

**The mistake:** accepting a caller-supplied bump, or deriving with `create_program_address` without insisting on the canonical bump.

**The exploit:** many `(seeds, bump)` combinations can yield valid off-curve addresses. A non-canonical bump yields a *different* PDA for the same seeds — letting an attacker create a parallel "vault" that passes seed checks built around caller-supplied bumps, splitting state your logic assumes is unique.

**The fix:** derive with `find_program_address` (returns the canonical bump), store the bump on the account at initialization, and validate with `bump = account.bump` thereafter. Anchor's `seeds`/`bump` constraints implement exactly this.

### 3.9 Duplicate mutable accounts

**The mistake:** an instruction takes two mutable accounts of the same type and assumes they are different.

**The exploit:** pass the same account as both `from` and `to` of an internal transfer. Depending on your arithmetic order, balance updates can be applied twice or cancel out — e.g., debit then credit the same account nets to zero cost while emitting a "paid" event.

**The fix:** `require_keys_neq!(from.key(), to.key())` (or an Anchor `constraint =`) whenever two accounts of the same type must be distinct.

### The checklist, compressed

For every instruction: **owner? signer? pinned to the right account? right type? checked math? pinned CPI targets? safe close? canonical bump? distinct accounts?** Nine questions. Nearly every Solana program exploit in history is a "no" to one of them.

## 4. Anchor as a security tool - and its limits

Anchor's core value proposition is security by construction: the constraint system makes the Section 3 checks declarative, visible in one place, and hard to forget.

**What Anchor eliminates when used idiomatically:**

| Vulnerability class | Anchor mechanism |
|---|---|
| Ownership checks | `Account<'info, T>` verifies owner |
| Type confusion | 8-byte discriminator, checked on load |
| Signer checks | `Signer<'info>` |
| Account substitution | `has_one`, `address =`, `seeds`/`bump` constraints |
| Non-canonical bumps | `bump` finds/validates canonical bump |
| Unsafe close | `#[account(close = dest)]` |
| Arbitrary CPI | `Program<'info, T>` pins program IDs |
| Overflow (partially) | templates set `overflow-checks = true` |

**Where Anchor does not save you:**

- **`UncheckedAccount` / `AccountInfo`.** Zero validation by design. Every occurrence needs a `/// CHECK:` comment that actually justifies why — auditors treat each one as a finding until proven otherwise.
- **`remaining_accounts`.** No deserialization, no constraints (Module 2). Anything consumed from `remaining_accounts` must be manually validated: owner, type, and identity.
- **`init_if_needed`.** Allows re-initialization pathways if an account can ever return to an ownerless state; requires a feature flag for a reason. Prefer `init` plus explicit flows.
- **Constraint gaps.** Anchor checks what you declare. A missing `has_one` is invisible to the compiler — the struct compiles and every attack in Section 3.3 still works. Constraints are assertions you must still *think* to write.
- **Business logic.** Interest math, liquidation thresholds, fee rounding, state-machine ordering — no framework validates your economics.

The right mental model: Anchor converts the checklist from "code you must write everywhere" into "declarations you must remember to make." That is an enormous improvement, not a delegation of responsibility.

## 5. Token security: authorities, delegates, and extensions

The token layer has its own security surface, especially relevant for enterprise issuers (Modules 3-5).

**Authority configuration is your token's root of trust:**

- **Mint authority** can create unlimited supply. Production tokens: move it to a multisig, or set to `None` after final issuance for fixed-supply instruments.
- **Freeze authority** can freeze any token account of the mint. It is the compliance lever for regulated assets (Module 4's Token ACL builds on it) — and a centralization risk to disclose for permissionless ones.
- **Owner/delegate on token accounts:** `approve` grants a delegate spending rights up to `delegated_amount`. Wallet-drainer campaigns rely on users signing delegate approvals; enterprise custody flows should monitor for unexpected delegates on treasury ATAs.

**Token-2022 extension interactions to review before integrating any mint:**

- **Permanent delegate** — an authority that can transfer or burn *any* holder's tokens at any time. Legitimate for regulated instruments (Module 5's force-transfer patterns); a rug vector in an unknown token. Always inspect.
- **Transfer hooks** — arbitrary program logic on every transfer. Integrators must treat the hook as an untrusted CPI target: it can fail transfers selectively or impose conditions. Inspect the hook program before accepting the mint into a protocol.
- **Transfer fees** — the received amount is less than the sent amount; naive `amount`-based accounting double-counts. Use `transfer_checked` semantics and read post-fee amounts.
- **Non-transferable, default-frozen states** — break composability assumptions (escrows, AMM deposits). Integration code should fail closed on unknown extensions rather than assuming Token-Program behavior.

**For protocol builders:** never assume an arbitrary mint is honest. Read its extension set, authorities, and decimals on-chain; gate what your program accepts.

## 6. Case studies: anatomy of real Solana exploits

Each maps cleanly onto the checklist — the point of this section is that none of these were exotic.

**Wormhole bridge (February 2022, ~$325M).** The signature-verification instruction accepted a sysvar account from the transaction without verifying it was the *real* `Instructions` sysvar; a deprecated function skipped the address check. The attacker passed a forged account, "verified" guardian signatures that were never checked, and minted 120k wETH unbacked. **Checklist items: account substitution + trusting an unverified account (3.1/3.3).** Lesson: verify *every* account, including "boring" sysvars; retire deprecated verification paths aggressively.

**Cashio (March 2022, ~$52M).** The stablecoin's mint instruction validated collateral through a chain of accounts, but one link — a bank's `crate_mint` field — was never tied back to the expected mint. The attacker constructed a parallel set of fake accounts that referenced each other consistently, satisfying every *local* check while representing worthless collateral, and minted CASH freely. **Checklist item: account substitution via an unvalidated link in a reference chain (3.3).** Lesson: validation must form a *closed* graph rooted in a trusted anchor (a PDA or a hardcoded address); one unpinned edge breaks the whole chain.

**Mango Markets (October 2022, ~$114M).** No account trick at all: the attacker took large positions in the thinly traded MNGO perp, pushed the spot price up ~10x across venues feeding the oracle, and borrowed against the inflated collateral value until the treasury drained. The program worked exactly as written. **Class: economic/oracle security (Section 8).** Lesson: code-level correctness does not protect a protocol whose economic assumptions (oracle liquidity, collateral caps) are attackable.

**Slope wallet (August 2022, ~$4-8M across ~9k wallets).** Not a program bug: the mobile wallet transmitted seed phrases to a centralized logging service in plaintext; whoever accessed those logs drained the keys. **Class: operational/key security (Section 7).** Lesson: the strongest on-chain program is irrelevant if key material leaks off-chain — vendor and telemetry review are part of the security perimeter.

## 7. Operational security: authorities, keys, and monitoring

Program code is one third of the posture. The other two thirds are who can change it and how you detect trouble.

**The upgrade authority lifecycle.** Solana programs are upgradable by default (Module 1B); the upgrade authority is effectively root on your program and every account it owns.

```
deployer keypair  →  multisig (Squads)  →  frozen (authority = None)
   (development)      (production)          (final, irreversible)
```

- Move to a multisig **before** mainnet value arrives; a single deployer keypair on a laptop is the most common institutional finding.
- Use threshold + timelock policies in the multisig for upgrades; announce upgrade windows.
- Freezing is the endgame for mature, stable programs — irreversible, so most enterprises hold at multisig with governance.
- The same lifecycle applies to every privileged authority: mint/freeze authorities, config admins, fee collectors. Inventory them; each is an attack target.

**Key management.**

- Hot keys (payment servers, crank bots) hold working balances only; treasury sits behind multisig/custody with sweep flows in between.
- Separate keys per environment; no production key ever appears in code, CI logs, or telemetry (the Slope lesson).
- Prefer role PDAs + on-chain RBAC (the Module 5 anchor-mmf `Role` pattern) over shared admin keys — revocation becomes an on-chain operation instead of a key rotation.

**Monitoring and incident response.**

- Stream your program's transactions (Geyser/Yellowstone, Module 9) and alert on: privileged instructions, authority changes, anomalous volumes, and failed-transaction spikes (probing looks like failures).
- Decide *before* launch what your emergency levers are: pause flags gating sensitive instructions (Module 5's `set_paused`), freeze authority for token-level response, and an upgrade path for code fixes.
- Rehearse the runbook: who signs the multisig at 3 a.m., in what order, with what communication plan. Audit findings are measured in hours-to-mitigate as much as in bugs found.

## 8. Economic security: oracles and market manipulation

A program can be memory-safe, checklist-clean, and still lose everything to economics (Mango). For any protocol that prices assets:

- **Oracle selection.** Use robust oracles with confidence intervals — and *read* the confidence interval: reject or discount prices when the band blows out.
- **Manipulation cost analysis.** Ask: what does it cost to move the price my program believes by X%? For thin markets the answer is often "less than what the protocol holds." Cap collateral weight for illiquid assets, or refuse them.
- **Rate limits and caps as blast-radius control.** Per-transaction and per-window limits (the Module 5 transfer-hook rate limiter is exactly this pattern) turn a total-loss scenario into a bounded one.

## 9. The audit process and security development lifecycle

**Before the audit:**

1. **Threat model early.** For each instruction: who may call it, what accounts does it trust, what is the worst state it can write? The Section 3 checklist is the template.
2. **Test in layers** (Module 2 tooling): unit tests on pure logic; LiteSVM/Mollusk tests that *attempt each checklist attack* — wrong signer, substituted account, duplicate accounts, non-canonical bump; a small end-to-end `anchor test` suite.
3. **Fuzz the deserialization and arithmetic boundaries** (Trident is the Anchor-aware fuzzing framework).
4. **Static review:** every `UncheckedAccount`'s `/// CHECK:` comment, every `unwrap`, every `as` cast, `overflow-checks = true` present.

**The external audit.** Established Solana firms include Neodyme, OtterSec, Zellic, Sec3, Trail of Bits, and Halborn. Budget realistically (weeks, not days, for a lending-scale protocol); provide the threat model and test suite — auditors finding *your documented invariants* false is the highest-value outcome. One audit is a snapshot: re-audit on significant upgrades.

**After launch:** bug bounty (self-hosted or a platform) with clear scope and payout tiers proportional to funds at risk; monitoring per Section 7; a disclosed security contact (`SECURITY.md`); and a practiced incident runbook.

**The lifecycle, compressed:** threat model → constraint-first implementation → adversarial tests → fuzz → internal review → external audit → staged mainnet rollout (caps raised over time) → monitoring + bounty → re-audit on change. Enterprises already run this shape for traditional systems; the content of each step is what this module localizes to Solana.

---

## Hands-on lab

An audit exercise: find the planted vulnerabilities in a deliberately broken Anchor program.

- **Materials:** the [challenge/](challenge/) folder contains a small staking-vault program with **seven planted vulnerabilities** spanning the Section 3 checklist
- **Deliverable:** a mini audit report — for each finding: the vulnerable lines, the attack transaction that exploits it, severity, and the one-line fix

## Additional resources

- [Neodyme — Common Pitfalls in Solana Development](https://workshop.neodyme.io/) — The canonical hands-on security workshop.
- [Sec3 — How to Audit Solana Smart Contracts](https://www.sec3.dev/blog/how-to-audit-solana-smart-contracts) — Audit-grade checklist reference.
- [Coral — Sealevel Attacks](https://github.com/coral-xyz/sealevel-attacks) — Minimal reproductions of each vulnerability class, with insecure/secure pairs.
- [Anchor Book — Security](https://book.anchor-lang.com/) — Constraint reference and security guidance.
- [Trident](https://ackee.xyz/trident) — Fuzzing framework for Anchor programs.
- [Helius — A Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security) — Readable overview of the vulnerability classes.
- [Solana Program Security Course (solana.com)](https://solana.com/developers/courses/program-security) — Official course covering the same checklist with exercises.
