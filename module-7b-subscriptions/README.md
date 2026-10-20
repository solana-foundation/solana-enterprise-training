# Module 7B: Subscriptions and Recurring Payments

## Why this module exists

Module 7 covers push payments: someone signs, funds move. Some enterprise revenue does not look like that. SaaS billing, usage allowances, merchant standing orders, and treasury-to-vendor retainers are all **pull** payments - the payee initiates, on a schedule, against an authorization the payer granted once.

Solana is a push-only chain with no native pull primitive, and the SPL Token delegate mechanism (one delegate per token account) is too coarse to build safe recurring billing on directly. This module walks the design space, then teaches the Solana Foundation's audited **Subscriptions Delegation Program**, which turns the single-delegate limitation into a general authorization layer: fixed allowances, recurring limits, and merchant-published plans.

It is a companion to Module 7 in the same way Module 1B is a companion to Module 1: runnable standalone for a team that specifically needs recurring billing, skippable for one that does not.

## Learning Objectives

- Explain why pull payments are hard on a push-only chain and why the raw SPL Token delegate is insufficient for recurring billing
- Compare the five recurring-payment patterns (delegate + crank, pre-funded escrow, permanent delegate billing, streaming, payment channels) on custody, revocability, and failure modes
- Describe the Subscription Authority model: one token delegate per (user, mint), many program-checked authorizations behind it
- Implement fixed delegations (allowances), recurring delegations (resetting limits), and subscription plans (merchant terms + subscribers + pullers) with the Kit SDK
- Design a collector service that handles the real failure modes: insufficient balance, expiry, revocation, frozen accounts, and stale approvals
- Explain how subscriptions interact with Token-2022 transfer hooks and the ACL / freeze compliance model from Modules 4 and 5
- Choose between per-request payments (x402), streamed micropayments (channels), and subscriptions for a given billing shape

## Topics Covered

- Pull payments on a push-only chain
- The design space: five patterns and their trade-offs
- The Subscriptions Delegation Program and the Subscription Authority
- Fixed delegation: allowances
- Recurring delegation: resetting limits
- Subscription plans: merchants, subscribers, pullers
- Lifecycle: cancel, cancel-now, resume, revoke, and stale-approval binding
- Token-2022 and compliance interactions
- Operating a collector: cranks, failure modes, dunning, events
- Choosing a billing primitive

## Prerequisite

Module 7 (Payments on Solana) - wallets, ATAs, transaction construction, fee payer abstraction. Module 10 (Agentic Payments) is referenced for the channels comparison but is not required.

## Slides

[Subscriptions - Slides](https://docs.google.com/presentation/d/1BPzIbxFOhRvmoB7Qwcpcmib2eSL7WFlht6LGYzJQjkc/edit?usp=sharing)

## Example

[subscription-plan](examples/subscription-plan/) - end-to-end plan lifecycle on the Subscriptions Delegation Program using `@solana/kit` and `@solana/subscriptions`: create plan, subscribe, collect, cancel, revoke.

---

## 1. Pull payments on a push-only chain

Every Solana transfer is initiated by a signature from the token account's owner or an approved delegate, in a transaction someone submits. There is no "standing order" the runtime executes on a schedule, and no way for a payee to reach into a payer's account. A subscription therefore always decomposes into two parts:

1. **An authorization** the payer grants once, bounding what may be pulled, by whom, and when.
2. **A collector** (a "crank") the payee runs, which submits a transaction each period that exercises the authorization.

The raw SPL Token primitive for (1) is `approve`: the owner names a delegate and a `delegated_amount`. It has two problems for billing:

- **One delegate per token account.** A USDC account can have exactly one approved authority at a time. A user who wants a monthly SaaS subscription, a capped spending allowance for a marketplace, and a standing vendor order on the same USDC balance cannot express that - each `approve` overwrites the last.
- **No time semantics.** `delegated_amount` is a static cap. Nothing resets it monthly, expires it, or ties it to billing terms. Every scheduling rule has to live off-chain in the collector, where the payer cannot verify it.

The EVM has the same problem (`approve`/`transferFrom` is a static allowance), which is why ERC-20 subscriptions ended up as a zoo of protocol-specific contracts. The Solana Foundation's answer is a single audited program that owns the delegate slot and enforces the schedule on-chain.

## 2. The design space: five patterns

Before the program, teams built subscriptions one of five ways. All still exist and each has a niche; the point of the comparison is to see what the program generalizes.

| Pattern | How it works | Custody | Revocable by payer | Fails when |
|---|---|---|---|---|
| **Delegate + crank** | `approve` a delegate; payee cranks `transfer` each period | Payer keeps funds | Yes, `revoke` any time | Balance short at pull time; delegate slot overwritten by another app |
| **Pre-funded escrow** | Payer deposits N periods into a PDA; program releases one period per interval | Program holds funds | Only the undrawn remainder | Escrow runs dry; payer capital is locked |
| **Permanent delegate** (Token-2022) | Issuer-controlled mint; the permanent delegate pulls from any holder | Payer keeps funds | No - the authority is the mint's | Only viable when the biller *is* the issuer (closed-loop tokens, Module 5) |
| **Streaming** | Continuous per-second vesting from a funded stream account | Program holds funds | Cancel stops the stream, remainder returns | Same capital lock as escrow; fits payroll/vesting more than billing |
| **Payment channels** (Module 10) | Escrow a ceiling, sign cumulative off-chain vouchers, settle once | Program holds ceiling | Forced close after grace period | Fits metered usage, not calendar billing |

Two axes matter for an enterprise choice: **who holds the money between periods** (custody), and **whether the payer can walk away** (revocability). Card-network subscriptions sit at "payer keeps funds, revocable" - which is the delegate pattern - and that is the corner the Subscriptions Delegation Program occupies, with the scheduling moved on-chain.

## 3. The Subscriptions Delegation Program

**Program ID:** `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`
**Source:** [solana-program/subscriptions](https://github.com/solana-program/subscriptions) - audited by Cantina; audit baseline and unaudited delta are tracked in the repo's `audits/` directory.

The core idea is a **Subscription Authority**: a PDA derived from `(user, token mint)` that the program controls. The user's token account approves that one PDA as its delegate, once. The delegate slot is now permanently occupied by the program, and the program decides - per transfer - whether a request matches any of the user's active authorizations:

```
user's USDC ATA ──approve──▶ SubscriptionAuthority PDA (user, USDC)
                                   │
                                   ├── FixedDelegation      (delegatee A, cap 500, expires Dec 31)
                                   ├── RecurringDelegation  (delegatee B, 50 / 30 days)
                                   └── SubscriptionDelegation (plan P, 20 / month, pullers {P's ops key})
```

**The authority cannot move funds by itself.** A transfer succeeds only when the caller, amount, receiver, and timing match one of the records. The single-delegate limitation is gone: many independent arrangements coexist on one token account, each with its own limits, and the user revokes any of them individually.

**Supported tokens:** SPL Token and Token-2022 mints, with restrictions - the program rejects mints carrying PermanentDelegate, ConfidentialTransfer, TransferFee, Pausable, NonTransferable, or MintCloseAuthority extensions (Section 8). Transfer hooks are supported: the program forwards the hook accounts into its `TransferChecked` CPI, so hook policy (rate limits, ACL checks) is enforced on delegated pulls exactly as on direct transfers.

**Events:** every delegated transfer and lifecycle change emits a self-CPI event (`FixedTransferEvent`, `RecurringTransferEvent`, `SubscriptionTransferEvent`, `SubscriptionCreated/Cancelled/ResumedEvent`, `PlanUpdatedEvent`), all in the published IDL. This is what a billing system indexes (Module 9) instead of scraping token balance changes.

**Versioning:** program-owned records carry a version field, with lazy in-place, explicit-migrate, and revoke-and-recreate upgrade paths - relevant for anyone building a long-lived billing integration on it.

### Creating the Subscription Authority

One per (user, mint); reused for every later delegation on that mint. The user signs; a sponsor may pay the rent (`payer`), in which case rent returns to the sponsor on close.

```typescript
import { createClient } from "@solana/kit";
import { solanaLocalRpc } from "@solana/kit-plugin-rpc";
import { signer } from "@solana/kit-plugin-signer";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  fetchMaybeSubscriptionAuthority,
  findSubscriptionAuthorityPda,
  subscriptionsProgram,
} from "@solana/subscriptions";

const client = createClient()
  .use(signer(userSigner))
  .use(solanaLocalRpc({ rpcUrl }))
  .use(subscriptionsProgram());

const [userAta] = await findAssociatedTokenPda({ mint, owner: userSigner.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const [authorityPda] = await findSubscriptionAuthorityPda({ user: userSigner.address, tokenMint: mint });

const existing = await fetchMaybeSubscriptionAuthority(client.rpc, authorityPda);
if (!existing.exists) {
  await client.subscriptions.instructions
    .initSubscriptionAuthority({ tokenMint: mint, tokenProgram: TOKEN_PROGRAM_ADDRESS, userAta })
    .sendTransaction();
}
```

Close it only after every dependent delegation has been revoked; the program refuses otherwise.

## 4. Fixed delegation: allowances

A fixed delegation lets a delegatee pull up to a **total** amount, optionally until an expiry. Each successful transfer reduces the remainder; when it reaches zero (or the expiry passes) transfers fail. This is the on-chain equivalent of a purchase order or a prepaid spending cap: "this vendor may draw up to 10,000 USDC from us before year end."

The delegator signs creation and revocation; the delegatee signs each pull. Revocation closes the delegation PDA and returns rent. Multiple fixed delegations to different delegatees coexist under one authority via the `nonce`.

## 5. Recurring delegation: resetting limits

A recurring delegation lets a delegatee pull up to `amountPerPeriod`, with the pulled total resetting every `periodLengthS`. This is a spending allowance rather than a subscription: the delegatee may pull *up to* the limit, in one or many transfers, and unused allowance does not roll over.

```typescript
const [delegationPda] = await findRecurringDelegationPda({
  subscriptionAuthority: authorityPda,
  delegator: userSigner.address,
  delegatee,
  nonce: 0n,
});

await client.subscriptions.instructions
  .createRecurringDelegation({
    tokenMint: mint,
    delegatee,
    nonce: 0n,
    amountPerPeriod: 1_000_000n,   // 1 USDC per period
    periodLengthS: 86_400n,        // daily
    startTs: 0n,                   // start when the tx lands
    expiryTs: now + 86_400n * 30n, // hard stop after 30 days
  })
  .sendTransaction();
```

Semantics worth noting:

- **The program rejects, it does not clamp.** A pull exceeding the period's remaining allowance fails outright; the collector must size requests.
- **`expiryTs` is a hard stop with no grace.** After expiry, transfers fail and the sponsor can recover rent.
- **`startTs = 0` means "start on landing"**, which widens the window for getting a user to sign; it then requires a non-zero `expiryTs`.
- The delegatee pulls with `transferRecurring`, naming any `receiverAta` - the receiver is not fixed at creation, which matters for treasury routing.

## 6. Subscription plans: merchants, subscribers, pullers

Plans invert the setup: the **merchant** publishes terms, and users **subscribe** to them. This is the SaaS shape.

**Create a plan.** The plan PDA is derived from `(merchant, planId)`. It fixes the mint, `amount` per period, `periodHours`, an optional `endTs`, a `destinations` allowlist for where funds may go, a `pullers` allowlist of keys permitted to collect, and a `metadataUri` for off-chain terms.

```typescript
await merchantClient.subscriptions.instructions
  .createPlan({
    planId: 1n,
    mint,
    amount: 5_000_000n,        // 5 USDC
    periodHours: 720n,         // monthly
    endTs: 0n,                 // open-ended
    destinations: [merchant.address],
    pullers: [opsKey],
    metadataUri: "https://example.com/plan.json",
  })
  .sendTransaction();
```

**Subscribe.** The subscriber accepts the plan's *current* terms; the subscription PDA is derived from `(plan, subscriber)`. Existing subscribers keep the terms they accepted when the merchant later updates the plan - new subscribers get the new ones. Authority creation and subscribe can be bundled in one transaction for fresh signups.

**Collect.** The merchant or a listed puller calls `transferSubscription` for up to the plan `amount` per billing period, to a receiver whose owner is in `destinations`. This is the crank.

**Update a plan.** Mutable fields can change, with guardrails: a finite `endTs` can only be shortened; on a sunset plan only the puller set can change, and only to a subset (to revoke a compromised puller). Every update carries the plan state observed at signing (`expectedCreatedAt`, `expectedEndTs`, `expectedPullers`, `expectedMetadataUri`) and is rejected as `StalePlanApproval` if the live plan differs.

That last rule is the **action-binding pattern from Module 5's maker/checker timelock**, applied to billing: a signed update is bound to the state it was approved against, so a stale signature cannot restore a removed puller or revert a later edit. Point participants back to `MmfError::TimelockActionMismatch` - same idea, same reason.

## 7. Lifecycle: cancel, cancel-now, resume, revoke

Subscriptions have more states than delegations because there are two parties with different rights:

| Action | Who signs | Effect |
|---|---|---|
| `cancelSubscription` | Subscriber | Marks the subscription as ending at the close of the current billing period; collection continues until then |
| `cancelSubscriptionNow` | Subscriber **and** plan owner | Expires immediately (or shortens a pending cancellation). Bound to `expectedCurrentPeriodStartTs`; rejected as `StaleSubscriptionApproval` if the period rolled |
| `resumeSubscription` | Subscriber | Reactivates a cancelled-but-not-yet-revoked subscription. Requires a valid, non-stale Subscription Authority; bound to `expectedExpiresAtTs` |
| `revokeSubscription` | Subscriber | Closes the subscription PDA after the cancellation expiry has elapsed; rent returns. After this the user must subscribe afresh |
| `revokeDelegation` | Delegator | Immediate close for fixed/recurring delegations |
| `closeSubscriptionAuthority` | User | Only after all dependents are gone |

The design mirrors consumer-protection expectations: the subscriber can always leave (cancel at period end, unilaterally), immediate termination needs both parties, and nothing the merchant signs can extend a subscriber's obligation. There is also a housekeeping path for **abandoned** delegations and subscriptions - expired records whose rent a sponsor can reclaim - which a production integration should run periodically.

## 8. Token-2022 and compliance interactions

For enterprise issuers this is where the module earns its place next to Modules 4 and 5 - and where the most important constraint lives.

**The program validates the mint and refuses several Token-2022 extensions outright.** At authority initialization it inspects the mint and rejects it if any of these extensions are present (error names from the SDK):

| Extension | Error | Why it is excluded |
|---|---|---|
| PermanentDelegate | `MintHasPermanentDelegate` | A second authority could move the same funds outside the program's accounting |
| ConfidentialTransfer | `MintHasConfidentialTransfer` | Delegated pulls need a plaintext balance to check against |
| TransferFee | `MintHasTransferFee` | Received amount would differ from the authorized amount |
| Pausable | `MintHasPausable` | Collections could be halted outside the program's state machine |
| NonTransferable | `MintHasNonTransferable` | Nothing to delegate |
| MintCloseAuthority | `MintHasMintCloseAuthority` | The mint could disappear under live subscriptions |

**Transfer hooks are supported.** The program resolves the mint's hook accounts (`resolveTransferHookAccounts` in the SDK) and forwards them into its `TransferChecked` CPI, so hook policy is enforced on delegated pulls exactly as on direct transfers, up to an account-count limit (`TransferHookTooManyAccounts`).

What this means for the Module 5 MMF mint is the teaching moment: **it is not eligible as-is.** The `anchor-mmf` mint carries PermanentDelegate for regulatory `force_transfer` / `force_burn`, which the subscriptions program rejects. An issuer who wants both compliance recovery and on-chain subscriptions has three options, each a real architecture decision:

1. **Bill in a different token.** Subscriptions are typically paid in a stablecoin (USDC has none of the excluded extensions), not in the tokenized instrument itself. For most enterprise billing this is the natural answer anyway.
2. **Drop the permanent delegate and rely on freeze + ACL.** Module 5 shows that default-frozen + allowlist + `freeze_account` covers most compliance sidelining without a permanent delegate; recovery then needs a legal process rather than a forced transfer.
3. **Run a purpose-built collector program** using the raw delegate pattern from Section 2, accepting that scheduling lives in your own audited code.

Other interactions to teach:

- **Hook rate limits apply to collections.** The rate limiter from Module 5's `mmf-transfer-hook` applies to subscription pulls too: a plan whose monthly `amount` exceeds a holder's per-window cap will fail at collection until the window rolls. Size plans against hook policy.
- **Frozen accounts cannot be pulled from.** Under the ACL model (default-frozen mint, thaw on approval, freeze to sideline), a subscriber whose account has been frozen for compliance will fail every collection with `AccountFrozen`. That is correct behavior - compliance outranks billing - but the collector must recognize it as a distinct failure from "insufficient funds" and route it to a compliance queue, not a dunning sequence.
- **The permanent delegate is not a billing tool.** Even where it exists, using `force_transfer` for routine collection removes the subscriber's ability to revoke and defeats the authorization model. It is for regulatory recovery only.

## 9. Operating a collector

The on-chain program bounds what a collector *may* do; the collector still has to be a well-behaved service. What a production crank looks like:

**Scheduling.** For each active subscription, compute the next collectable time from `currentPeriodStartTs + period`. Collect once per period, idempotently keyed on `(subscription, period start)`, so a retried transaction after a network failure does not double-bill - the program would reject the second pull anyway, but the collector should not spend fees learning that.

**Failure taxonomy.** Collections fail for reasons that need different responses:

| Failure | Program / token error | Response |
|---|---|---|
| Subscriber balance short | Token program insufficient funds | Dunning: retry on a schedule (e.g. day 1, 3, 7), notify, then cancel |
| Period allowance exhausted | Program limit error | Bug in the collector - alert, do not retry this period |
| Subscription expired / cancelled | Program state error | Stop; run revoke cleanup |
| Account frozen | `AccountFrozen` | Compliance queue, not dunning |
| Hook rejected (rate limit) | Hook program error | Retry after the window; review plan sizing |
| Stale authority (`StaleSubscriptionAuthority`) | Program | User re-initialized their authority; require re-subscribe |

**Observability.** Index the program's events (Module 9) rather than polling balances: `SubscriptionTransferEvent` carries the puller and receiver, `SubscriptionCancelledEvent` carries the expiry, so revenue recognition, churn, and dunning state are all derivable from the event stream.

**Key hygiene.** Pullers are ordinary keys listed on the plan. Run them as hot keys with no other authority, rotate by updating the plan's puller set, and rely on the destination allowlist so a compromised puller can only route funds to the merchant's own accounts.

## 10. Choosing a billing primitive

The three payment modules together give an enterprise three primitives; the choice follows the billing shape:

| Billing shape | Primitive | Module |
|---|---|---|
| Per request, agent or API pays as it goes | x402 / MPP per-request payment | 10 |
| Metered usage, many small increments, one settlement | Payment channels (`upto`, `session`) | 10 |
| Calendar billing: fixed amount every period | Subscription plan | 7B |
| Capped allowance a counterparty draws against | Fixed or recurring delegation | 7B |
| Payroll / vesting, continuous accrual | Streaming | (ecosystem) |
| Issuer-controlled recovery, not billing | Permanent delegate | 5 |

They compose. A pay.sh gateway can put an HTTP API behind a subscription plan so that a subscribed agent is not charged per request; a channel can meter overage beyond a plan's included quota. Teach the primitives as a toolbox, not as competitors.

---

## Hands-on lab

Run the full plan lifecycle against a local validator or devnet using the [example](examples/subscription-plan/).

- **Steps:**
  1. Merchant creates a plan (5 USDC / 30 days, one puller, destination allowlist)
  2. Subscriber initializes a Subscription Authority and subscribes; inspect the token account - the delegate is the authority PDA, not the merchant
  3. Puller collects; then attempt a second collection in the same period and read the rejection
  4. Subscriber cancels; collect again before period end (succeeds), then after (fails); revoke
  5. Attempt `updatePlan` with stale `expected*` fields and observe `StalePlanApproval`

## Additional resources

- [Subscriptions - Overview (solana.com)](https://solana.com/docs/payments/subscriptions/overview) - Program purpose, models, events, audit status.
- [Create Subscription Authority](https://solana.com/docs/payments/subscriptions/create-subscription-authority), [Fixed Delegation](https://solana.com/docs/payments/subscriptions/fixed-delegation), [Recurring Delegation](https://solana.com/docs/payments/subscriptions/recurring-delegation), [Subscription Plan](https://solana.com/docs/payments/subscriptions/subscription-plan) - Per-model guides with TypeScript and Rust.
- [Revoke Abandoned Delegations](https://solana.com/docs/payments/subscriptions/revoke-abandoned) - Housekeeping for expired records.
- [solana-program/subscriptions](https://github.com/solana-program/subscriptions) - Program source, SDKs, audits.
- [Demo application](https://solana-subscriptions-program.vercel.app/) - End-to-end reference UI.
- [Pay.sh guide](https://solana.com/docs/payments/pay-sh) - Putting an HTTP API behind a subscription plan.
- [Helius - Subscriptions and Recurring Payments on Solana](https://www.helius.dev/blog/solana-subscriptions-recurring-payments) - Background on the pre-program patterns.
