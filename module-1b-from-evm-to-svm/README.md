# Module 1B — From EVM to SVM

## Why this module exists

The move from Solana-curious to Solana-productive is gated almost entirely on one thing:
bridging from the EVM mental model. Teams are Solidity-fluent. They know financial systems.
They are not confused about blockchains; they are confused about why a smart
contract on Solana doesn't store its own state, why every transaction has to
list its accounts up front, and where their `mapping(address => Balance)` went.

The rest of the curriculum — Anchor, SPL Tokens, Token Extensions, RWAs,
payments — sits on top of that bridge. If the bridge is unstable, everything
above it wobbles. This module is the bridge.

This module assumes the participant has either completed Module 1 (Solana
Overview) or arrived with general Solana awareness. It is designed to be
runnable as a standalone day for an EVM-native team that wants to spend their
first session purely on the architectural shift.

## Learning Objectives

By the end of this module, participants will be able to:

- Translate Solidity contract patterns into the Solana account model with
  confidence — describe where a contract's state would live, how its calls
  would be expressed, and how its access control would be enforced
- Explain why Solana programs are stateless and how PDAs play the role of
  storage slots and mappings
- Map ERC-20 mechanics to the Mint + Token Account + ATA model, including the
  consequences for transfer authority and decimals
- Describe how Cross-Program Invocations (CPIs) replace cross-contract calls,
  and why every account a CPI will touch must be passed forward
- Articulate why reentrancy is a structural impossibility on Solana, and which
  new failure modes replace it
- Apply the Solana program security checklist that takes the place of EVM-era
  reentrancy guards
- Construct a Solana transaction with versioned format, address lookup tables,
  compute budget, and priority fees; choose an appropriate commitment level
  for a given use case
- Navigate the Solana developer toolchain (Anchor, LiteSVM, `@solana/kit`) by
  mapping each tool to its EVM analog

## Prerequisite

This module assumes the participant has:

- Working familiarity with Solidity and the EVM execution model — `msg.sender`,
  storage slots, `mapping`, contract deployment, ABI/calldata
- Completed Module 1 (Solana Overview) or equivalent baseline awareness of
  Solana's architecture, accounts, programs, rent, and PDAs

This module does **not** assume Rust or Anchor experience — those come in
Module 2.

## Topics Covered

- The mental-model shift: "you bring the state"
- Account model translation: storage slots, mappings, and PDAs
- ERC-20 vs SPL Token (Mint, Token Account, ATA)
- Composability: `call` vs CPI; the account-graph propagation rule
- Reentrancy as a structural property, not a guard
- The Solana program security checklist
- Transactions in practice: blockhash, expiry, versioned format, ALTs
- Compute budget, priority fees, and local fee markets
- Commitment levels: a decision framework
- Client tooling and developer workflow

## Slides

[Placeholder — Module 1B slide deck to be created]

---

## 1. The mental-model shift: "You bring the state"

The single most useful sentence for an EVM developer learning Solana is this:
**on Ethereum, the contract knows where its state lives; on Solana, the caller
brings it.**

In Solidity, a contract's storage is part of the contract itself. When you
call `balanceOf(addr)`, the contract reads from its own storage slot. The
caller passes a function selector and arguments; the contract resolves
everything else internally. State discovery is the contract's job.

On Solana, programs are stateless. They contain executable code and nothing
else. All data lives in separate accounts, each owned by some program. When a
client wants to call a Solana program, the client must determine in advance
exactly which accounts the program will read and write, and pass every one of
them in the transaction. State discovery is the *caller's* job.

This sounds like a small detail. It is not. It is the source of every
"I tried to port my pattern from Solidity and it doesn't work" moment in the
first week of Solana development. It changes:

- **How clients are built.** Solana clients spend significant code resolving
  account addresses before sending a transaction. EVM clients almost never do.
- **How protocols compose.** EVM contracts can call any other contract with
  just an address and an ABI. Solana programs can only call into a CPI graph
  that has been laid out in the original transaction.
- **How transactions are sized.** Solana transactions carry account lists
  inline. Big batches require Address Lookup Tables (Section 7). EVM
  transactions carry only calldata.
- **How indexers work.** EVM events are an indexed first-class concept. Solana
  has no equivalent of indexed event topics — you stream and parse logs and
  state changes externally (Module 9).

Internalizing this shift is the bulk of the work in this module. Every other
topic below is a consequence of it.

### Worked example: a counter contract

The simplest possible illustration. A counter that anyone can increment, with
its current value readable by anyone.

**Solidity (EVM):**

```solidity
contract Counter {
    uint256 public count;

    function increment() external {
        count += 1;
    }
}
```

The contract holds `count` in its own storage. Anyone reading the contract via
RPC gets the value back. Anyone calling `increment()` causes the contract to
mutate its own state.

**Anchor (Solana):**

```rust
#[program]
pub mod counter {
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.counter.value = 0;
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        ctx.accounts.counter.value += 1;
        Ok(())
    }
}

#[account]
pub struct Counter { 
  pub value: u64 
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8, seeds = [b"counter"], bump)]
    pub counter: Account<'info, Counter>,
    #[account(mut)] pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [b"counter"], bump)]
    pub counter: Account<'info, Counter>,
}
```

The same logical contract has split into three things: the **program** (the
code, identified by a program ID), an **account** that holds the counter's
value (a PDA derived from the seed `"counter"`), and the **account-list
declarations** (`Initialize`, `Increment`) that describe which accounts each
instruction touches and how they should be validated.

A client calling `increment()` must:
1. Derive the counter PDA address from the seed and the program ID
2. Construct a transaction that includes the counter PDA in its account list
3. Sign and send it

The program itself never "looks up" the counter. The transaction hands it
over.

### What this changes downstream

Once this mental model is in place, several Solana facts that seem strange in
isolation become inevitable:

- **Why programs declare `Context<Accounts>`** — because the program needs to
  know which accounts it will be given before it can execute.
- **Why transactions have a size limit issue with batches** — because every
  account is named inline (mitigated by ALTs; see Section 7).
- **Why Anchor uses constraints** — because account validation has to happen
  somewhere, and doing it manually for every account every time is error-prone.
- **Why "remaining accounts" exists** — because sometimes you don't know how
  many accounts a CPI will need at compile time, so Anchor leaves an escape
  hatch.

## 2. Account model translation

The single most useful concept-mapping table for an EVM developer:

| EVM concept | SVM equivalent | Notes |
|-------------|----------------|-------|
| Contract bytecode | Program (BPF binary) | Program is a special account with `executable = true`, owned by the BPF Loader. |
| Contract storage | Accounts owned by the program | One account per logical "slot." Programs cannot modify accounts they don't own. |
| Storage slot (single value) | A program-owned account | Account is created via the System Program, then assigned to the program. |
| `mapping(K => V)` | A set of PDAs, one per key | Each PDA is derived from a fixed seed prefix plus the key (e.g., a wallet pubkey). |
| `msg.sender` | A `Signer<'info>` account | Must be declared explicitly in the instruction's account list. There is no implicit caller. |
| `tx.origin` | Fee payer | Solana has no transitive "origin"; only signers and the fee payer. |
| `address(this)` | The program ID (`crate::ID`) | The program's own identity. |
| `calldata` | Instruction data | An opaque `&[u8]` byte slice; Anchor deserializes into typed arguments. |
| Function selector | First 8 bytes of instruction data (Anchor) | Anchor derives a discriminator from the instruction name. |
| Constructor | `initialize` instruction | Solana programs have no constructors. State is bootstrapped via a normal instruction. |
| Immutable deployment | Upgradable by default | Solana programs are upgradable unless the upgrade authority is explicitly set to `None` ("frozen"). |
| Proxy pattern (UUPS, Transparent) | Not needed | The BPF Loader Upgradeable supports in-place upgrades. The upgrade authority is the governance vector. |
| ABI (JSON) | IDL (JSON) | Generated by Anchor from `#[program]` macros. |
| Events / logs | `msg!()`, `emit!`, and external streaming | No indexed event topics. Off-chain consumers stream via Geyser / Yellowstone (Module 9). |
| `block.timestamp` | `Clock::get()?.unix_timestamp` | Available via the Clock sysvar. |
| `block.number` | Slot (`Clock::get()?.slot`) | Slots are ~400 ms; epochs are ~2 days. |
| Gas (gwei) | Compute Units (CUs) | Capped at 1,400,000 CU per transaction. |
| Global gas auction | Base fee + priority fee per writable account | Local fee markets — see Section 7. |
| Nonce | Recent blockhash | Transactions expire ~150 slots (~60 s) after the blockhash was produced. |
| Block confirmations | Commitment levels (processed / confirmed / finalized) | Explicit tiers chosen per use case — see Section 8. |
| Mempool | None (Gulf Stream) | Transactions are forwarded directly to the upcoming leader. |
| ethers.js / viem | `@solana/web3.js` (legacy) or `@solana/kit` (Web3.js 2.0) | Functional, tree-shakeable. |
| Hardhat / Foundry | Anchor + LiteSVM / Bankrun / Mollusk | Multiple test layers — see Section 9. |
| `revert` / `require` | `Result::Err(...)` / `require!(...)` | Anchor provides `require!`, `require_eq!`, etc. macros. |

A few rows deserve elaboration.

### From `mapping(address => Balance)` to PDAs

A Solidity mapping is the most idiomatic way to associate a value with a key:

```solidity
mapping(address => uint256) public balances;
```

The EVM stores each entry at a deterministic slot derived from the mapping
slot and the key. The contract reads from that slot on demand.

The Solana equivalent is one PDA per key. The seed pattern encodes the
mapping structure:

```rust
// Derive a balance account for a specific user
let (balance_pda, bump) = Pubkey::find_program_address(
    &[b"balance", user.key().as_ref()],
    &program_id,
);
```

Every balance lives in its own account. To read or modify a user's balance,
the caller derives the PDA and includes it in the transaction. The program
validates the PDA matches its expected seeds via Anchor constraints:

```rust
#[account(mut, seeds = [b"balance", user.key().as_ref()], bump)]
pub balance: Account<'info, Balance>,
```

This pattern is so common it is worth memorizing. Every Solidity mapping
translates to a "PDA per key" on Solana.

### `msg.sender` is not implicit

On Ethereum, `msg.sender` is always available — it's the immediate caller of
the current function. On Solana, every signer is an explicit account in the
transaction. The instruction declares a field as a `Signer<'info>`, and Anchor
verifies that the corresponding account in the transaction has signed.

```rust
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,           // declared signer
    #[account(mut, has_one = user)]    // verifies the vault belongs to the signer (or through seeds)
    pub vault: Account<'info, Vault>,
}
```

There is no `Signer::current()` or implicit caller. Authorization is something
the instruction author wires explicitly.

### Programs are upgradable by default

In Solidity, immutability is the default and upgradability requires a proxy
pattern. On Solana, the reverse: programs are deployed via the BPF Loader
Upgradeable, which supports in-place upgrades by whoever holds the **upgrade
authority**. The upgrade authority is a regular pubkey — usually a deployer
keypair initially, often migrated to a multisig (Squads) for production
governance.

To make a Solana program immutable, the upgrade authority is set to `None`
(the "frozen" state). This is irreversible. Production-critical programs
typically pass through a deployer → multisig → frozen lifecycle, with
multi-sig governance handling all but the final freeze.

## 3. ERC-20 vs SPL Token

This is the second most common source of EVM-to-Solana confusion. The two
models diverge in ways that matter for transfer authority, decimals handling,
and account discovery.

### The shape of an ERC-20

In Solidity, an ERC-20 is a single contract that owns its own balance ledger:

```solidity
contract Token {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public decimals;
    uint256 public totalSupply;
    // transfer, approve, transferFrom, mint, burn, ...
}
```

One contract. One state. Token holders are keys in a mapping inside the
contract.

### The shape of an SPL Token

On Solana, a token is split across three account types, all owned by the
**Token Program** (not by the issuer):

- **Mint account** — one per token. Stores `supply`, `decimals`,
  `mint_authority`, `freeze_authority`. Owned by the Token Program. Address
  identifies the token.
- **Token account** — one per (owner, mint) pair. Stores `amount`, `owner`,
  `delegate`. Owned by the Token Program. The account's `owner` field
  determines who can authorize transfers.
- **Associated Token Account (ATA)** — the canonical per-owner token account
  for a given mint. Derived deterministically from `(owner, mint, token
  program)` via the Associated Token Program.

The Token Program is a single program shared across the ecosystem. Every
ERC-20-style token reuses the same code. The issuer's role is to create the
mint and configure its authorities; they do not deploy a contract.

### What this changes in practice

- **Transfer authority is per-account, not per-pair.** ERC-20 has
  `allowance[owner][spender]`. SPL Token has a single `delegate` field per
  token account, with a separately tracked `delegated_amount`. The semantics
  are similar, but the per-pair allowance pattern from EVM does not exist.
- **Decimals are the mint's responsibility.** SPL clients always handle raw
  base units (analog of `wei`); decimals come from the mint account. The
  `transfer_checked` instruction (which Token-2022 requires) makes the
  expected decimals an instruction parameter, preventing the
  "missed decimals scaling" class of bug.
- **No on-token hooks by default.** ERC-20 has no transfer hooks. ERC-777
  introduced them at the cost of broad compatibility issues. SPL has them in
  Token-2022 (the Transfer Hook extension; Module 4), but they are opt-in per
  mint.
- **Token discovery is deterministic.** Given a wallet address and a mint, any
  client can compute the ATA address. No registry lookup needed.

### Common mistakes from EVM developers

- **Sending tokens to a wallet's address.** Solana wallets don't hold tokens
  directly. You send to the receiver's ATA. If the ATA doesn't exist, the
  sender creates it as part of the transaction. EVM developers often skip the
  ATA-creation step and wonder why the transfer fails.
- **Assuming `transfer` is one call.** A full token transfer involves the
  Token Program, the sender's ATA, the receiver's ATA, the mint, and
  authority signatures. Anchor's `transfer_checked` CPI wraps it neatly, but
  the account list looks startling at first.
- **Reaching for proxies for upgrades.** Mint configuration is set by mint
  authorities, not by replacing the token contract. Want to change something?
  Update the authority via the Token Program. Want to retire a token? Set the
  mint authority to `None` after final issuance.

## 4. Composability: `call` vs CPI

EVM composability is *late-bound*. A contract holds the address of another
contract and calls it via `call`, `staticcall`, or `delegatecall`. The target
contract's interface need not be known at compile time. State the callee
needs, the callee fetches.

Solana composability is *early-bound*. A program calls another program via a
Cross-Program Invocation (CPI), and every account the callee will touch must
be in the original transaction's account list. The transaction effectively
declares a precomputed call graph.

### The propagation rule

A simple way to think about it: when program A calls program B via CPI, every
account program B will touch must already be in A's instruction's account
list, and A passes them through to the CPI. There is no "the callee fetches
what it needs" pathway. The transaction propagates account access forward.

Anchor offers an escape hatch for cases where the caller doesn't know the
full account list at compile time: `remaining_accounts: &[AccountInfo]`. These
are accounts that arrived in the transaction but were not deserialized or
validated by Anchor. A CPI can forward them to the callee. This is how
programs that interact with many configurable downstream programs (e.g., DeFi
aggregators routing through multiple AMMs) work.

### Consequences for protocol design

- **A swap aggregator routing through five AMMs must include the accounts for
  all five in a single transaction.** This is why Solana transactions for
  Jupiter swaps often look enormous — they carry the account lists for every
  hop. ALTs (Section 7) make this practical at scale.
- **You cannot CPI into "whatever program is at this address."** You must know
  what program you're calling and which accounts it expects. Dynamic dispatch
  patterns from Solidity do not have a direct analog.
- **Cross-program state mutation is explicit.** When program A CPIs into
  program B and B mutates an account, A's transaction must have marked that
  account as `mut`. No silent state changes in third-party programs.

This is a constraint, but it is also a feature. The transaction's account
list is a static manifest of everything it will read and write — making
parallel execution (Sealevel) possible, and making transaction analysis far
more tractable than EVM trace analysis.

## 5. Reentrancy is a structural property, not a guard

Every Solidity developer carries the reentrancy guard pattern in muscle
memory. The 2016 DAO hack and every reentrancy-pattern audit finding since
have made it the most well-known smart-contract failure mode.

On Solana, reentrancy is not a vulnerability that requires a guard. It is
prevented at the runtime level by a stronger invariant: **a program cannot
appear twice in the call stack of a single transaction.** A program cannot be
re-entered while it is already executing, regardless of intent.

### Why this works: the write-lock model

The Solana runtime takes a single write-lock per writable account in a
transaction. Two transactions that touch overlapping writable accounts cannot
execute in parallel. Within a single transaction, the same constraint holds
at the program level: a program cannot CPI into itself, because that would
require taking the same write-lock twice.

This is enforced by the runtime, not by the program. It is not optional. It
cannot be disabled. Every Solana program gets it for free.

### What this means for EVM developers

The reentrancy guard pattern (`nonReentrant` modifier, mutex variable, etc.)
has no analog on Solana because it has no purpose. You do not write reentrancy
guards. You do not audit for reentrancy bugs.

But this does not mean Solana programs have no security pitfalls — it means
the *failure modes are different*. The next section is the replacement
checklist.

## 6. The Solana program security checklist

The classes of bug a Solana program auditor looks for. These replace the
reentrancy concern from EVM and represent the actual security surface of a
modern Anchor program.

### Account ownership

Every account a program reads or writes must be owned by the expected
program. Anchor's typed account wrappers (`Account<'info, T>`,
`InterfaceAccount<'info, T>`) verify this automatically. Raw `AccountInfo`
does not — if you use it, you must check `account.owner == &expected_program`
yourself.

**Failure mode:** an attacker passes an account they control where a
program-owned account is expected, tricking the program into reading
attacker-controlled data.

### Signer checks

Every privileged action must verify that the appropriate authority has signed
the transaction. Anchor's `Signer<'info>` type enforces this. Using
`AccountInfo` for a field that should be a signer requires explicit
`require!(account.is_signer, ...)`.

**Failure mode:** an attacker invokes an admin-only instruction without being
the admin, because the program never checked.

### Account substitution

Even when ownership and signer checks pass, an attacker may pass a different
account of the right type than the program expects. The two most common
patterns to defend against this:

- **`has_one` constraints** to verify that an account's stored authority
  matches another account in the instruction:

  ```rust
  #[account(mut, has_one = authority)]
  pub vault: Account<'info, Vault>,
  pub authority: Signer<'info>,
  ```

- **`seeds` constraints** to verify that a PDA was derived from expected
  seeds:

  ```rust
  #[account(seeds = [b"vault", user.key().as_ref()], bump)]
  pub vault: Account<'info, Vault>,
  ```

**Failure mode:** an attacker passes their own account where the user's
account was expected, causing funds to flow to the wrong place.

### Discriminator confusion

Anchor prepends an 8-byte discriminator to every account it manages, derived
from the type name. This prevents an account of type A from being deserialized
as type B even if the byte layouts are identical. Programs that don't use
Anchor (or that bypass it with raw account access) must defend against this
manually.

**Failure mode:** an attacker passes a token account where a vault state
account is expected, and the program reads token data as vault data.

### Arithmetic overflow

Rust's default arithmetic does not panic on overflow in release builds
unless `overflow-checks = true` is set in `Cargo.toml`. Anchor templates set
this by default; verify it for any production program.

**Failure mode:** silent integer overflow drains a balance counter or
miscalculates a fee.

### CPI authority confusion

When a program signs a CPI on behalf of a PDA, it must pass exactly the right
seeds. Mismatched seeds cause the CPI to fail; missing PDA validation
elsewhere lets an attacker pass a different PDA than the program expected.

**Failure mode:** the program signs a CPI for a PDA it does not actually
control, or fails to validate that the PDA passed in matches the expected
one.

### Closing accounts safely

When closing an account, the program must zero out the data and set the
discriminator to an invalid value. Anchor's `#[account(close = dest)]`
constraint does this correctly. Manual close logic that just transfers
lamports leaves a "zombie" account vulnerable to reuse.

**Failure mode:** a closed-but-unzeroed account is reused in a future
transaction as if it were live, causing logic to operate on stale data.

### Missing rent checks for newly created accounts

Account creation via the System Program requires rent-exemption. Programs
that create accounts on the fly (e.g., during a transfer-hook callback) must
ensure rent is provided.

### The short version

If you came from EVM, your audit checklist used to be: reentrancy, overflow,
unchecked external calls, access control, and front-running. On Solana, the
checklist becomes: ownership, signers, account substitution (via `has_one`
and `seeds`), discriminator confusion, overflow, CPI authority, safe closing,
and rent. Reentrancy drops off. The rest is new.

The standard public references for this checklist are Neodyme's "Common
Pitfalls in Solana Development," Sec3's audit checklist, and OtterSec's
audit reports. Bookmarking them is recommended.

## 7. Transactions in practice

The mechanics of constructing and landing a transaction on Solana differ from
EVM in ways that affect every production deployment. The four topics that
must be on the table: recent blockhash, versioned transactions, compute
budget, and priority fees.

### Recent blockhash and expiry

"There is no nonce on Solana." Instead, every transaction includes a
**recent blockhash** — a 32-byte commitment to a recent block. A transaction
is valid only if its blockhash is recent enough: roughly the last 150 slots
(~60 seconds at 400 ms slots).

**Consequences:**

- A transaction that is not landed within ~60 seconds expires and must be
  resubmitted with a fresh blockhash.
- "Did my transaction land?" is a real question — you cannot assume that
  silence means failure. Poll `getSignatureStatuses` until you see a
  confirmation or until the blockhash expires.
- No nonce-replay issues. A given signature can only land once, because the
  blockhash binds it to a window.

### Versioned transactions and Address Lookup Tables (ALTs)

Solana transactions have a hard size cap of ~1,232 bytes. Every account in
the account list takes 32 bytes. For payment batches, swap aggregators, or
any operation touching many accounts, this is the binding constraint.

**Versioned transactions (v0)** introduced **Address Lookup Tables**. An ALT
is an on-chain account containing a list of pubkeys. A v0 transaction can
reference accounts by their *index in an ALT* instead of inline by their full
32-byte pubkey. This compresses 32 bytes into roughly 1 byte per referenced
account.

In practice, ALTs make 30+ account transactions trivial. Without them, the
practical ceiling on a payment batch is 4-6 transfers. With them, it is
20-30.

Every production payment, swap aggregation, or batch operation should use v0
transactions and ALTs. The legacy (untagged) transaction format is fine for
prototyping but should not be the default for new code.

### Compute Budget and priority fees

Every transaction has a default compute limit of 200,000 CUs per instruction
(up to 1.4M total). Every transaction's fee is structured as:

- **Base fee:** 5,000 lamports per signature. Fixed.
- **Priority fee:** `(compute_unit_price in micro-lamports) × (compute_units
  requested)`. Optional, but in practice required for landing on a busy
  network.

Both are set via the Compute Budget Program:

```rust
ComputeBudgetInstruction::set_compute_unit_limit(units: u32)
ComputeBudgetInstruction::set_compute_unit_price(micro_lamports: u64)
```

The right priority-fee setting depends on the recent fee market. The two
common approaches:

- **Helius / Triton / QuickNode priority fee APIs** — RPC providers expose
  estimated priority fees by percentile and target landing window. This is
  the most common production pattern.
- **`getRecentPrioritizationFees`** — the standard RPC method. Returns a list
  of recent prioritization fees per slot. Compute a percentile manually.

A common production-grade payment send looks like:

1. Build instruction list
2. Add Compute Budget instructions at the front (limit and price)
3. Build v0 transaction with ALTs
4. Sign and send with `skipPreflight: true` (preflight wastes time when you
   already trust your tx)
5. Poll for landing; retry with a fresh blockhash and a higher priority fee
   if it doesn't land

## 8. Commitment levels: a decision framework

Solana exposes three commitment levels for transaction confirmation. Choosing
the right one is a daily design decision for any institutional system.

| Commitment | Latency | Reorg risk | When to use |
|------------|---------|------------|-------------|
| `processed` | < 400 ms | Possible | UI updates, optimistic flows, internal indexing where eventual correction is acceptable. |
| `confirmed` | ~1 sec | Negligible in practice (supermajority voted) | Default for most production flows. Payment processing, swap confirmation, custody-side transaction recording. |
| `finalized` | ~12-13 sec | None (irreversible) | Settlement-grade decisions. Anything that triggers an off-chain action that cannot be reversed (release goods, fiat payout, etc.). |

### Rules of thumb

- **For UI feedback:** `confirmed`. `processed` is too brittle and `finalized`
  is too slow.
- **For an indexer:** `confirmed`. If you index `processed`, you must handle
  rare reorgs; the indexing throughput gain is rarely worth the complexity.
- **For off-chain payouts triggered by an on-chain event:** `finalized`. Do
  not pay a counterparty against a `confirmed`-only observation.
- **For internal accounting:** `confirmed` for live balances; periodically
  reconcile against `finalized` for the official ledger.

EVM developers will recognize this as similar to choosing how many block
confirmations to wait for, but the tiers are explicit, discrete, and named —
which simplifies design conversations.

## 9. Client tooling and developer workflow

A short reference for the most common tooling questions an EVM developer
asks.

### Client SDKs

- **`@solana/kit` (Web3.js 2.0):** the current recommended client SDK.
  Functional, tree-shakeable, typed. Roughly the Solana analog of `viem` in
  the EVM ecosystem. Use this for new code.
- **`@solana/web3.js` (legacy, v1.x):** the long-standing client SDK.
  Class-based, broadly compatible. Use this when integrating with existing
  ecosystem libraries that haven't migrated.
- **`@coral-xyz/anchor`:** the TypeScript client generated from an Anchor
  IDL. Auto-generated typed methods. Use this for testing and for client
  code that drives an Anchor program.

### Testing

- **LiteSVM:** in-process Solana runtime in Rust. Fastest test option. Best
  for unit-level testing of program logic. Used in the Module 2 vault tests.
- **Mollusk:** similar to LiteSVM but with different ergonomic
  trade-offs.
- **Anchor's `anchor test`:** spins up a local validator and runs TypeScript
  tests against it. End-to-end, slower, but closest to production behavior.
- **Local validator (`solana-test-validator`):** a full local node, mostly
  used for client development and manual exploration.

### Tooling map

| EVM tool | Solana analog |
|----------|---------------|
| Hardhat | Anchor (CLI + framework) |
| Foundry's `forge` | `cargo build-sbf` + LiteSVM / Bankrun |
| `ethers.js` / `viem` | `@solana/kit` (preferred) or `@solana/web3.js` |
| Tenderly | Explorer + Helius / Triton tracing |
| Etherscan | Solscan, SolanaFM, Solana Explorer |
| The Graph | Helius DAS API + custom indexer (Carbon / Vixen) |
| Alchemy / Infura | Helius, Triton, QuickNode, Alchemy (also on Solana) |
| OpenZeppelin contracts | SPL programs + Token-2022 + Anchor patterns |

## 10. EVM ↔ SVM translation reference (cumulative)

A consolidated lookup table — useful as an instructor handout or laminated
cheat sheet. Same content as the inline tables above, gathered for reference.

| EVM | SVM | One-line note |
|-----|-----|---------------|
| Smart contract | Program | Stateless — code only. Data lives in separate Accounts. |
| Contract storage | Account data | Each piece of state is its own Account, owned by a Program. |
| Storage slot | Program-owned account | One account per logical slot. |
| `mapping(K=>V)` | A PDA per key | Seed pattern encodes the mapping structure. |
| `msg.sender` | `Signer<'info>` | Must be declared in the instruction's account list. |
| `tx.origin` | Fee payer | No transitive origin concept. |
| `address(this)` | `crate::ID` | The program's own ID. |
| `calldata` | Instruction data (`&[u8]`) | Anchor deserializes typed args. |
| Function selector | First 8 bytes (Anchor discriminator) | Derived from the instruction name. |
| Constructor | Initialize instruction | No special constructor concept. |
| Immutable code | Upgradable by default | Set upgrade authority to `None` to freeze. |
| UUPS / Transparent proxy | BPF Loader Upgradeable in place | No proxy patterns needed. |
| ABI (JSON) | IDL (JSON) | Generated by Anchor. |
| Events / logs | `msg!()`, `emit!`, Geyser streaming | No indexed event topics. |
| `block.timestamp` | `Clock::get()?.unix_timestamp` | Via Clock sysvar. |
| `block.number` | Slot | Slots are ~400 ms; epochs ~2 days. |
| Gas (gwei) | Compute Units | 1.4M CU max per transaction. |
| Global gas auction | Local fee markets (per writable account) | Priority fee + base fee. |
| Nonce | Recent blockhash | Transactions expire ~150 slots. |
| Block confirmations | `processed` / `confirmed` / `finalized` | Three explicit tiers. |
| Mempool | None (Gulf Stream) | Direct forwarding to upcoming leader. |
| Reentrancy guard | Runtime invariant (write-lock) | No guard needed; can't be re-entered. |
| `require` / `revert` | `require!` / `Err(...)` | Anchor macro. |
| ethers.js / viem | `@solana/kit` | Functional, tree-shakeable. |
| Hardhat / Foundry | Anchor + LiteSVM / Bankrun | Multiple test layers. |
| ERC-20 | Mint + Token Account (+ ATA) | Token Program owns everything. |
| `transferFrom` | `transfer` with delegate | Per-account delegate, not per-pair allowance. |
| `approve` | Token::approve | Sets delegate + `delegated_amount`. |
| ERC-721 / ERC-1155 | Token-2022 NFTs or Compressed NFTs (cNFTs) | Multiple standards. |
| `delegatecall` | No direct analog | Use CPI with explicit account propagation. |

---

## Quiz

Test your understanding of the EVM-to-SVM mental model shift. Each question uses a realistic enterprise scenario.

---

### Question 1 — Mapping State to Solana

Your team is porting a Solidity lending protocol to Solana. The original contract stores each user's collateral balance in a `mapping(address => uint256)`. What is the correct Solana equivalent, and how does the client interact with it?

**A.** A single program account stores all balances in a serialized HashMap. The client calls the program and it looks up the user internally.

**B.** One PDA per user, derived from a seed like `[b"collateral", user.key().as_ref()]`. The client derives the PDA address and includes it in the transaction's account list.

**C.** The program stores balances in its own executable account's data field, similar to how a Solidity contract stores state in its bytecode account.

**D.** A single token account holds all collateral, and the program tracks individual shares via instruction data.

<details>
<summary>Answer</summary>

**B.** On Solana, every `mapping(K => V)` translates to a "PDA per key" pattern. Each user's collateral lives in its own account derived deterministically from a seed prefix and the user's public key. The client must derive this address and pass it in the transaction — the program never "looks up" accounts on its own. This is the most fundamental architectural difference from EVM: the caller brings the state.

</details>

---

### Question 2 — Transaction Size and Payment Batches

An enterprise payment system sends USDC to thousands of recipients per day. A developer from your Ethereum team builds the Solana integration using legacy (pre-v0) transactions and hits a wall at 5 transfers per transaction. What is the root cause, and what is the production fix?

**A.** Solana transactions are limited to 5 instructions. The fix is to send more transactions in parallel.

**B.** Each account in the transaction takes 32 bytes inline, and the transaction has a ~1,232-byte size cap. The fix is to use versioned (v0) transactions with Address Lookup Tables, compressing each account reference to ~1 byte.

**C.** The Token Program limits transfers to 5 per call. The fix is to use a custom program that batches transfers internally.

**D.** Solana's compute budget caps out at 5 transfers. The fix is to request more compute units via the Compute Budget Program.

<details>
<summary>Answer</summary>

**B.** Solana transactions have a hard size cap of ~1,232 bytes. Each account in the list costs 32 bytes inline, and a token transfer touches ~5 accounts (sender ATA, receiver ATA, mint, authority, Token Program). With legacy transactions, you hit the size ceiling at 4–6 transfers. Versioned (v0) transactions with Address Lookup Tables compress account references from 32 bytes to ~1 byte each, pushing the practical ceiling to 20–30 transfers per transaction. Every production payment system should use v0 + ALTs.

</details>

---

### Question 3 — Commitment Levels for Settlement

Your compliance team asks: "When our on-chain settlement system detects a confirmed payment, it triggers a fiat payout via our banking API. Which Solana commitment level should we use before initiating the payout?"

**A.** `processed` — it's the fastest and any confirmed transaction will eventually finalize.

**B.** `confirmed` — supermajority-voted, negligible reorg risk, and good enough for financial operations.

**C.** `finalized` — the payout is irreversible off-chain, so the on-chain trigger must also be irreversible.

**D.** No commitment level is needed; once a transaction is submitted it is guaranteed to land.

<details>
<summary>Answer</summary>

**C.** When an on-chain event triggers an irreversible off-chain action (fiat payout, goods release, ledger entry), you must wait for `finalized` commitment (~12–13 seconds). A `confirmed` transaction has negligible reorg risk in practice, but "negligible" is not "zero" — and reversing a fiat wire is not an option. The rule: if you can't undo the off-chain consequence, don't act until finalization.

</details>

---

### Question 4 — Account Security

During a security review of your Solana program, an auditor flags an instruction that accepts a `vault` account as raw `AccountInfo` instead of Anchor's typed `Account<'info, Vault>`. The program reads the vault's balance from the account data and authorizes a withdrawal. What class of vulnerability does this introduce?

**A.** Reentrancy — the attacker can re-enter the program during the withdrawal CPI.

**B.** Account ownership and discriminator confusion — an attacker can pass any account they control (including one with fabricated data), and without ownership checks or discriminator validation, the program will read attacker-controlled bytes as a valid Vault.

**C.** Integer overflow — raw AccountInfo does not enforce numeric type safety.

**D.** Front-running — without Anchor types, transactions are visible in the mempool and can be sandwiched.

<details>
<summary>Answer</summary>

**B.** Anchor's typed wrappers (`Account<'info, Vault>`) automatically verify two things: that the account is owned by the expected program, and that its discriminator matches the `Vault` type. Raw `AccountInfo` skips both checks. An attacker can pass an account they own with carefully crafted data that, when read as a Vault struct, shows an inflated balance — authorizing a fraudulent withdrawal. Reentrancy (A) is structurally impossible on Solana. Solana has no mempool (D), so traditional front-running doesn't apply in the EVM sense.

</details>

---

### Question 5 — Token Account Creation

Your team's Solana program needs to transfer SPL tokens from a PDA-controlled vault to a user's wallet. A developer writes the CPI call but forgets to create the user's Associated Token Account (ATA) before the transfer. What happens, and how should this be handled in production?

**A.** The Token Program automatically creates the ATA if it doesn't exist, deducting rent from the fee payer.

**B.** The transfer silently succeeds and the tokens are held by the Token Program until the ATA is created.

**C.** The transaction fails. The correct approach is to include an ATA creation instruction (via the Associated Token Program) before the transfer, or use a create-if-needed helper, with the sender or fee payer covering the rent.

**D.** The tokens are sent to the user's system account (wallet address) directly, bypassing the need for an ATA.

<details>
<summary>Answer</summary>

**C.** Solana wallets don't hold tokens directly — tokens live in Associated Token Accounts. If the recipient's ATA doesn't exist, the Token Program transfer will fail. The standard production pattern is to include a `create_associated_token_account` instruction (or an idempotent create-if-needed variant) in the same transaction, before the transfer instruction. The fee payer or sender covers the ATA's rent-exemption cost. This is one of the most common mistakes EVM developers make when porting token logic to Solana.

</details>

---

### Question 6 — Local Fee Markets

During a period of heavy DEX activity on Solana, your enterprise payment program's
transactions are confirming slowly. A teammate suggests sharply increasing the priority
fee, sized to how busy the network looks overall. A more experienced engineer pushes back
and says to estimate the fee differently. What's the reasoning?

**A.** Priority fees are fixed by the protocol and can't be set per transaction, so raising
them won't help.

**B.** A transaction's priority fee is a bid (`price × requested CU limit`), and congestion
is localized to each writable account's per-block CU budget. Hot DEX accounts force the
transactions competing for *those* accounts to bid up — but that says nothing about your
payment program's unrelated accounts. Size the fee against your transaction's own writable
set, not global network load.

**C.** Priority fees are burned rather than paid to the validator, so increasing them
doesn't change transaction ordering.

**D.** The Compute Budget Program caps the priority fee per transaction, so anything above
the threshold is ignored.

<details>
<summary>Answer</summary>

**B.** Solana has no per-account fee *pricing* — the priority fee is just your bid,
`fee = price × requested CU limit`, with the base fee flat at 5,000 lamports/signature.
What localizes congestion is that each writable account has a fixed per-block CU budget
(currently 12M CU), and the leader's scheduler packs transactions by reward-to-cost ratio.
So when DEX pool accounts are saturated, the transactions write-locking *those* accounts
must bid higher to land, while a transaction touching only cold accounts has its own
block-space slack and can land near the floor. Bidding off global activity overpays for
contention you aren't subject to. Estimate against your transaction's actual writable
accounts — using the native `getRecentPrioritizationFees` (which accepts an account list)
or a provider estimator like Helius, Triton, or QuickNode — and keep the CU limit tight,
since the fee scales with the limit you *request*, not the compute you *use*.

**Caveat worth probing:** if your transactions touch only cold accounts, they shouldn't be
slow — so the first move is to *diagnose*, not assume. Two usual culprits: (1) a shared hot
account hiding in your writable set — a global config PDA, a shared fee vault, or a
transfer-hook program that write-locks shared state on every transfer — which quietly drops
you into someone else's local market; or (2) the block hitting its *global* CU ceiling,
where even cold-account transactions compete for raw inclusion. Account-aware estimation
fixes (1); (2) is the one case where overall network load legitimately matters.

</details>

---

### Question 7 — CPI Account Propagation

Your team is designing a Solana program where Program A calls Program B via CPI, and Program B needs to read from three additional accounts. An EVM developer on the team assumes Program B will fetch these accounts internally, just like a Solidity contract would via `SLOAD`. Why is this assumption wrong, and what does this mean for the original transaction?

**A.** Program B can fetch any account via a syscall, but it's slower than passing them directly, so it's a performance optimization to include them.

**B.** Solana programs cannot access any account that isn't in the transaction's account list. All three accounts must be included in the original transaction by the client, and Program A must forward them to Program B in the CPI. The transaction declares a complete, precomputed call graph.

**C.** Program B can read accounts freely, but can only write to accounts in the transaction list. The three accounts only need to be included if they're writable.

**D.** Program B can access any account on-chain, but the runtime charges extra compute units for accounts not in the transaction list.

<details>
<summary>Answer</summary>

**B.** This is the core composability difference between EVM and SVM. On Ethereum, a contract can call any other contract and that contract fetches whatever state it needs internally. On Solana, every account any program in the call chain will touch must be listed in the original transaction. The client must precompute the entire account graph. Program A passes these accounts forward to Program B via the CPI. This constraint enables Solana's parallel execution (Sealevel) — the runtime knows every read and write before execution begins — but it requires more upfront work from the client and careful use of `remaining_accounts` for dynamic CPI patterns like DEX aggregators.

</details>

---

## Additional resources

- [Solana Cookbook — for EVM developers](https://solanacookbook.com/) — Pattern reference; pair with this module.
- [Anchor Book](https://book.anchor-lang.com/) — Deeper Anchor reference for the next module.
- [Neodyme — Common Pitfalls in Solana Development](https://workshop.neodyme.io/) — Security checklist source material.
- [Sec3 Audit Checklist](https://www.sec3.dev/blog/how-to-audit-solana-smart-contracts) — Audit-grade reference for the security section.
- [Solana Program Examples](https://github.com/solana-developers/program-examples) — Canonical examples for every common pattern.
- [Helius — How Priority Fees Work on Solana](https://www.helius.dev/blog/priority-fees-understanding-solanas-transaction-fees) — Operational reference for Section 7.
- [Solana Compute Units](https://solana.com/docs/core/fees) — Official fee documentation.
