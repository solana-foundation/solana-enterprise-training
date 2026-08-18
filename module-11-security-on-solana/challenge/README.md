# Challenge: Audit the Staking Vault

A small Anchor staking-vault program with **seven planted vulnerabilities** spanning the Module 11 Section 3 checklist.

## Your task

Produce a mini audit report. For each finding:

1. The vulnerable location (file + lines)
2. The attack transaction that exploits it (describe the accounts and signers an attacker would pass)
3. Severity (critical / high / medium / low) with a one-line justification
4. The fix (usually one constraint or one check)

Work through the account structs first — most findings are unpinned accounts visible in the `#[derive(Accounts)]` definitions before you even read the handlers.

## The program

`src/lib.rs` implements a staking vault:

- `initialize_pool` — create the global pool (holds reward rate, total staked)
- `initialize_stake` — create a user's stake account
- `stake` — deposit tokens into the vault, credit the stake account
- `unstake` — withdraw tokens and accrued rewards
- `set_reward_rate` — admin-only: change the reward rate
- `close_stake` — close a user's stake account, returning rent

## Rules

- Do not look at `SOLUTION.md` until you have found what you can
- Count of findings is given (7 checklist) so you know when to keep looking
- Assume the caller is fully hostile (Module 11, Section 2)

```

When you are done, compare against [SOLUTION.md](SOLUTION.md).
