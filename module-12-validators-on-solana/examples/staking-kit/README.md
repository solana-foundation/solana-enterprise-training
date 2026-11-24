# Staking Kit - Validators and Native Staking with @solana/kit

Four small scripts that cover the delegator side of the validator economy, driven from TypeScript with [@solana/kit](https://github.com/anza-xyz/kit) and the generated `@solana-program/stake` client. There's no custom program: just the built-in Stake Program and RPC.

| Script | What it does | Signs? |
|---|---|---|
| `01-inspect-validators.ts` | Reads the validator set (`getVoteAccounts`): stake, commission, last vote, delinquency, superminority | No |
| `02-create-and-delegate.ts` | Creates a stake account and delegates it to a validator in one atomic transaction | Yes |
| `03-check-stake.ts` | Decodes the stake account: authorities, delegation, lifecycle status, and inflation rewards per epoch | No |
| `04-deactivate-withdraw.ts` | Unstakes: deactivate, wait an epoch, then withdraw and close. Run it twice | Yes |

## Run it

The fastest way is a local validator with short epochs, so the whole lifecycle takes about a minute:

```bash
# terminal 1
solana-test-validator --reset --slots-per-epoch 64

# terminal 2
npm install
export RPC_URL=http://127.0.0.1:8899
npm run inspect-validators
npm run create-and-delegate     # ACTIVATING
npm run check-stake
# wait ~30s for an epoch boundary
npm run check-stake             # ACTIVE, rewards start
npm run deactivate-withdraw     # DEACTIVATING
# wait for the next epoch
npm run deactivate-withdraw     # withdrawn, account closed
```

Without `RPC_URL` the scripts default to **devnet**. There `01` and `03` work right away. `02` needs about 2 devnet SOL (use [faucet.solana.com](https://faucet.solana.com) if the airdrop is rate limited), and each lifecycle step waits for a real epoch boundary of about a day.

Options:

```bash
VOTE_ACCOUNT=<vote pubkey> npm run create-and-delegate  # choose the validator yourself
STAKE_SOL=2 npm run create-and-delegate                 # delegate more than the default 1 SOL
TOP_N=25 npm run inspect-validators                     # longer table
RPC_URL=https://api.mainnet-beta.solana.com npm run inspect-validators   # read-only on mainnet
```

The demo wallet and stake account address are saved in `.stake-state.json` (git-ignored) so the scripts can pick up where they left off. **This is for throwaway test keys only.**

## What to notice

- **One transaction, three instructions.** `02` does `CreateAccount`, `InitializeChecked`, and `DelegateStake` atomically. Either the stake exists and is delegated, or nothing happened.
- **The validator never holds your SOL.** The stake account is owned by the Stake Program. Only *your* stake authority can redelegate or deactivate, and only *your* withdraw authority can move lamports. A validator going offline costs you rewards, not principal (there is no automated slashing today).
- **Activation is per epoch.** Delegate in epoch N, and the stake is active and earning from N+1. Unstaking takes the same wait in reverse. Treasury desks that need same-day liquidity use LSTs for that reason (Module 6).
- **Rewards auto-compound.** Inflation rewards are paid into the stake account at each epoch boundary and added to the delegation. `03` reads them with `getInflationReward`.
- **Choosing a validator is a due-diligence task.** `01` shows the raw inputs: commission, delinquency, stake concentration. Section 6 of the module README covers what else to check.

## Traditional finance comparison

| TradFi / EVM concept | Solana native staking |
|---|---|
| Fixed-term deposit at a bank | Stake account delegated to a validator; earns per epoch, about a 1-epoch notice period to withdraw |
| Custodian holds the asset | No custodian: the Stake Program holds it and *your* withdraw key controls it |
| Ethereum validator: 32 ETH, run your own node or use a pool | Any amount above the minimum delegation, delegated to any validator, no node required |
| ETH withdrawal queue (days to weeks) | Deactivate, then withdraw at the next epoch boundary (about a day) |
| Liquid staking token (stETH) | LSTs such as JitoSOL, mSOL, bSOL (Module 6) |

## Version note

This example pins `@solana-program/stake` `~0.8.0`, the last client generation that still sends the legacy sysvar accounts (`Clock`, `Rent`, `StakeHistory`, stake config) that older Stake Program builds require. Releases from 0.9 onward drop them and only work on clusters running the newer Stake Program. Check against your target cluster before upgrading.
