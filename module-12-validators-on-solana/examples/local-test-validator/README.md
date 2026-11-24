# Lab: A Validator on Your Laptop

`solana-test-validator` is a single-node Solana cluster: one validator that is the leader for every slot and holds 100% of the stake. It is the same Agave validator code that runs on mainnet, wrapped up for local development. That makes it the cheapest way to see what a validator actually *is*: the keypairs, the vote account, the stake, the ledger on disk, and the RPC it serves.

No server, no SOL, about 20 minutes.

## Prerequisites

- Solana CLI (Agave) installed: `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`
- Check it: `solana --version` and `solana-test-validator --version`

Every command below targets the local cluster through `-ul` (short for `--url localhost`).

---

## Step 1 - Start a validator and look at what it created

```bash
solana-test-validator --reset
```

`--reset` wipes any previous ledger. Leave it running and open a second terminal. The validator wrote everything into `./test-ledger`:

```bash
ls test-ledger
```

```text
accounts/  rocksdb/  genesis.bin  snapshot-*.tar.zst  validator.log
validator-keypair.json  vote-account-keypair.json  stake-account-keypair.json
faucet-keypair.json  tower-*.bin
```

Those three keypair files are the same three accounts every mainnet validator has (module README, section 4):

| File | What it is | Mainnet equivalent |
|---|---|---|
| `validator-keypair.json` | **Identity**: signs blocks and gossip, pays fees | Hot key on the validator server |
| `vote-account-keypair.json` | **Vote account** address: receives votes, earns credits, holds commission settings | Created once with `solana create-vote-account` |
| `stake-account-keypair.json` | A **stake account** delegated to this validator | Delegators' stake accounts (yours, SFDP, LST pools) |
| `rocksdb/` | The ledger: blocks and shreds | Separate NVMe disk in production |
| `accounts/` | The live accounts database (AccountsDB) | Separate NVMe disk in production |
| `snapshot-*.tar.zst` | Full-state snapshot | What a new node downloads to join the cluster |

## Step 2 - Inspect the cluster like an operator

```bash
solana -ul validators          # the validator set: identity, vote account, commission, skip rate, stake
solana -ul epoch-info          # current epoch, slot range, progress
solana -ul leader-schedule | head   # who leads each slot (here: always you)
solana -ul block-production    # leader slots vs. blocks produced -> skip rate
solana -ul gossip              # nodes in gossip, with their TPU and RPC ports
curl -s localhost:8899/health  # the health endpoint load balancers poll -> "ok"
```

Now look at the validator's own accounts:

```bash
solana -ul vote-account test-ledger/vote-account-keypair.json
solana -ul stake-account test-ledger/stake-account-keypair.json
solana -ul balance test-ledger/validator-keypair.json
```

Abridged vote account output:

```text
Validator Identity: FCta...
Vote Authority: D52k...
Withdraw Authority: D52k...
Commission: 0%
Inflation Rewards Commission: 0 basis points
Inflation Rewards Collector: D52k...
Block Revenue Collector: FCta...
Block Revenue Commission: 0 basis points
BLS Public Key: 1111...
```

Things to point out:

- **Identity and vote account are different keys.** The identity is a hot key on the server. The vote account's **withdraw authority** controls the money and should never be on the server.
- **Newer vote accounts set two commissions:** one on inflation rewards and one on block revenue (fees). Each has its own collector address.
- **The BLS public key** is what an Alpenglow validator uses to sign the off-chain votes that are aggregated into certificates (Module 1). On a local test validator it is empty.
- The stake account says who may **delegate/deactivate** (stake authority) and who may **withdraw** (withdraw authority). The validator itself has neither.

## Step 3 - Fast epochs to watch staking happen

Mainnet epochs are 432,000 slots (about a day at 200ms slots). Locally you can shrink them so the stake lifecycle plays out in seconds:

```bash
solana-test-validator --reset --slots-per-epoch 64
```

With this running, do the [staking-kit](../staking-kit/) scripts against it:

```bash
cd ../staking-kit
npm install
export RPC_URL=http://127.0.0.1:8899
npm run inspect-validators
npm run create-and-delegate   # delegated in epoch N
npm run check-stake           # ACTIVATING
# ...wait ~30s for an epoch boundary...
npm run check-stake           # ACTIVE, rewards appear
npm run deactivate-withdraw   # deactivate
# ...wait for the next epoch...
npm run deactivate-withdraw   # withdraw and close
```

## Step 4 - Clone mainnet state

A test validator can copy accounts and programs from a live cluster into its genesis. This is how teams test against real USDC, real AMMs, or real oracle accounts without spending money:

```bash
solana-test-validator --reset \
  --url mainnet-beta \
  --clone EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --clone-upgradeable-program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
```

```bash
solana -ul account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v | head -4
# Owner: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA   <- the real USDC mint
solana -ul program show JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
# Owner: BPFLoaderUpgradeab1e11111111111111111111111   <- the real Jupiter v6 program
```

> [!NOTE]
> Clones are a snapshot taken at startup. After that they only change through transactions on your local cluster. `--clone` copies a single account; use `--clone-upgradeable-program` for programs, because it also copies the separate ProgramData account that holds the bytecode.

## Step 5 - Load your own program at genesis

Instead of `solana program deploy`, you can bake a compiled program into genesis at a fixed address, for example the Module 2 vault:

```bash
# from module-2-rust-concepts-and-anchor/examples/vault after `anchor build`
solana-test-validator --reset \
  --bpf-program <VAULT_PROGRAM_ID> target/deploy/vault.so
```

Use `--upgradeable-program <ID> <SO> <UPGRADE_AUTHORITY>` if you want it deployed as upgradeable, with an authority you control.

## Step 6 - Warp ahead in time

```bash
solana-test-validator --reset --warp-slot 1000000
solana -ul slot              # ~1000000
solana -ul block-production  # skip rate 100% - every warped-over slot counts as "skipped"
```

Warping is useful for code that depends on `Clock` (vesting, timelocks like the Module 5 MMF timelock, interest accrual). It is also a good way to show what **skip rate** measures: leader slots that produced no block. On mainnet a high skip rate means lost fee revenue for the operator and worse service for users. It is one of the first numbers delegators and the SFDP look at.

## Step 7 - Read the ledger and logs

```bash
tail -f test-ledger/validator.log         # the same log format a mainnet operator watches
agave-ledger-tool --ledger test-ledger bounds   # slot range stored in this ledger
```

Run the validator in the foreground with `--log` to stream the log instead of the dashboard.

## Step 8 (optional) - Attach a Geyser plugin

Geyser is the plugin interface the validator uses to stream account and transaction updates out of process. Module 9's indexing stack (Yellowstone gRPC, LaserStream) is built on it. A test validator can load a plugin exactly like a production RPC node:

```bash
solana-test-validator --reset --geyser-plugin-config yellowstone-config.json
```

```json
{
  "libpath": "/path/to/libyellowstone_grpc_geyser.dylib",
  "log": { "level": "info" },
  "grpc": { "address": "0.0.0.0:10000" }
}
```

> [!IMPORTANT]
> A Geyser plugin is a native shared library loaded into the validator process. It must be built against the **same Agave version** as the validator, or loading will fail or crash. Build [yellowstone-grpc](https://github.com/rpcpool/yellowstone-grpc) at the tag that matches `solana-test-validator --version`. See its README for the full config schema.

---

## What a test validator is *not*

| | `solana-test-validator` | Real mainnet validator |
|---|---|---|
| Nodes | 1, leader for every slot | about 650-800 staked validators, rotating leaders |
| Consensus | Trivial: it owns 100% of stake | Alpenglow Votor: off-chain BLS votes, 80% / 60% thresholds |
| Network | Localhost | Gulf Stream/QUIC ingress, Turbine propagation, gossip |
| Costs | Free | Hardware, bandwidth, and the per-epoch VAT |
| Hardware | A laptop | 12+ core CPU, 256-512 GB RAM, multiple NVMe disks, 10 Gbps |

For the real thing, see the [testnet runbook](../testnet-validator-runbook.md).
