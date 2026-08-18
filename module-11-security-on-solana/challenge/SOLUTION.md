# Solution: Staking Vault Audit

Eight findings — seven checklist vulnerabilities plus one economics bug. Each maps to a Module 11 Section 3 item and a real-world case study.

---

## Finding 1 — `stake`/`unstake`/`set_reward_rate`: missing `has_one` on stake and pool (account substitution)

**Severity: Critical.** Checklist 3.3. Case-study analog: Cashio.

`Stake` in `unstake` is only `Account<'info, Stake>` with `mut` — nothing binds `stake.owner` to the `owner` signer, and nothing binds `stake.pool` to the passed `pool`. An attacker signs as themselves but passes a *victim's* stake account, or pairs a real stake account with a *different* pool that has a huge `reward_rate`.

**Fix:**

```rust
#[account(mut, has_one = owner, has_one = pool)]
pub stake: Account<'info, Stake>,
```

Apply the same `has_one = owner` to `Stake` context and `CloseStake`.

---

## Finding 2 — `unstake`: `vault` and `pool` not pinned (account substitution / wrong vault)

**Severity: Critical.** Checklist 3.3.

`vault` is an unconstrained `TokenAccount`. The program signs the transfer with the pool PDA, but never checks that the passed `vault` is `pool.vault`. An attacker passes *any* token account the pool PDA can authorize, or mismatches vault/pool to drain a different pool.

**Fix:** pin the vault to stored state and derive the pool as a PDA:

```rust
#[account(mut, seeds = [b"pool"], bump = pool.bump, has_one = vault)]
pub pool: Account<'info, Pool>,
#[account(mut, address = pool.vault)]
pub vault: Account<'info, TokenAccount>,
```

---

## Finding 3 — `set_reward_rate`: admin never verified (missing signer/authority binding)

**Severity: Critical.** Checklist 3.2 / 3.3.

The `SetRewardRate` struct takes an `admin: Signer` but never checks it equals `pool.admin`. *Anyone* can sign as themselves and set the reward rate arbitrarily (then unstake for a massive reward — compounds with Finding 1).

**Fix:**

```rust
#[account(mut, has_one = admin)]
pub pool: Account<'info, Pool>,
pub admin: Signer<'info>,
```

---

## Finding 4 — `close_stake`: manual close leaves data intact (account revival)

**Severity: High.** Checklist 3.7. Case-study analog: revival attacks.

The handler moves lamports out but never zeroes the data or the discriminator. Within the same transaction the attacker refunds the rent, and the "closed" stake account survives with its `amount` intact — replayable against `unstake`.

**Fix:** use Anchor's close constraint and delete the manual logic:

```rust
#[account(mut, has_one = owner, close = owner)]
pub stake: Account<'info, Stake>,
```

---

## Finding 5 — `unstake`: unchecked arithmetic (overflow) and cast

**Severity: High.** Checklist 3.5.

`amount * pool.reward_rate / 10000 * elapsed` can overflow `u64` (attacker-influenced `elapsed` and `amount`), and `stake.amount += amount` / `total_staked` updates are unchecked. Also `(now - stake.last_update) as u64` casts a subtraction that can be negative if `last_update` is in the future.

**Fix:** `checked_mul`/`checked_add`/`checked_sub` with `.ok_or(error!(...))?`, compute the reward in `u128`, and guard the timestamp delta.

---

## Finding 6 — `stake`/`unstake`: `pool.total_staked` desync and duplicate-account risk

**Severity: Medium.** Checklist 3.9 + integrity.

`unstake` never decrements `pool.total_staked`, so the pool's accounting drifts from reality. Additionally nothing prevents `user_token` and `vault` from being the same account (self-transfer no-op that still credits the stake).

**Fix:** decrement `total_staked` on unstake with checked math; `require_keys_neq!(user_token.key(), vault.key())`.

---

## Finding 7 — `initialize_stake`: `pool` not verified as a real pool / stake not bound to pool identity

**Severity: Medium.** Checklist 3.3.

`pool` is `Account<'info, Pool>` (type-checked) but the stake is created without tying it to the *canonical* pool PDA; combined with Finding 1's missing `has_one = pool` on later instructions, a user can register a stake against a look-alike pool. Pin the pool by seeds:

```rust
#[account(seeds = [b"pool"], bump = pool.bump)]
pub pool: Account<'info, Pool>,
```

---

## Debrief mapping

| Finding | Checklist | Case study |
|---|---|---|
| 1, 2, 7 | 3.3 account substitution | Cashio |
| 3 | 3.2 signer/authority | (classic admin-auth miss) |
| 4 | 3.7 account revival | revival attacks |
| 5 | 3.5 arithmetic | (integer overflow class) |
| 6 | 3.9 duplicate accounts + integrity | — |
