# Runbook: Running an Agave Validator on Testnet

This runbook takes an infra team from a bare Linux server to a voting validator on **Solana testnet**. Testnet is where the network tests new releases, and where SFDP applicants have to prove themselves first. The steps are the same as on mainnet, with smaller stakes.

> [!WARNING]
> **Check against the official docs before you run this.** Flags, versions, and cluster entrypoints change with every Agave release. This runbook reflects [docs.anza.xyz](https://docs.anza.xyz/operations/setup-a-validator) as of **November 2026** (Agave 4.4 stable, 4.5 beta on testnet, Alpenglow active). Where the docs and this file disagree, the docs win.

**Scope:** Agave (or Jito-Agave) on Ubuntu 24.04. For Firedancer, follow [docs.firedancer.io](https://docs.firedancer.io). The concepts are the same, but the config is a TOML file instead of CLI flags.

---

## 0. Decide what you are running

| Goal | Node | Needs stake? | Votes? |
|---|---|---|---|
| Serve your own app's reads and transactions | **RPC node** (`--no-voting`, full RPC enabled) | No | No |
| Stream data into your index (Module 9) | RPC node + Geyser plugin | No | No |
| Take part in consensus and earn rewards | **Consensus validator** | Yes | Yes |

Most enterprises need an RPC node first, or a dedicated node from a provider. This runbook covers the consensus validator, and section 9 shows the changes for an RPC node.

## 1. Hardware

The minimums from [Anza's requirements page](https://docs.anza.xyz/operations/requirements). Testnet can get by with somewhat less, but sizing for mainnet avoids a rebuild later.

| Component | Consensus validator | RPC node |
|---|---|---|
| CPU | 12 cores / 24 threads+, 2.8 GHz+ base, AVX2 + SHA extensions (AMD Zen 3+ / Intel Ice Lake+). Prefer clock speed over core count | 16 cores / 32 threads+ |
| RAM | 256 GB+ ECC (board supporting 512 GB) | 512 GB+ if you enable full account indexes |
| Disk: accounts | 1 TB+ NVMe (PCIe Gen3 x4+, high TBW) | Larger |
| Disk: ledger | 1 TB+ NVMe, **separate** from accounts | Larger for longer history |
| Disk: snapshots | 500 GB+ NVMe | Same |
| Network | Public IPv4, no NAT, 2 Gbps symmetric minimum, **10 Gbps recommended** | 1 Gbps is enough if unstaked |

Bare metal in a data center is the norm. Cloud VMs work for RPC but are usually expensive for consensus, mostly because of bandwidth egress. For decentralization, avoid the most crowded data centers and ASNs: the SFDP caps how much of its stake can sit in any one provider.

## 2. OS tuning

Create a non-root user and apply the kernel settings the validator expects:

```bash
sudo adduser sol
sudo bash -c "cat >/etc/sysctl.d/21-agave-validator.conf <<EOF
# UDP buffer sizes
net.core.rmem_default = 134217728
net.core.rmem_max = 134217728
net.core.wmem_default = 134217728
net.core.wmem_max = 134217728
# Memory-mapped files limit
vm.max_map_count = 1000000
# Open file descriptors
fs.nr_open = 1000000
EOF"
sudo sysctl -p /etc/sysctl.d/21-agave-validator.conf

# raise the open file limit for systemd services
sudo sed -i 's/^#\?DefaultLimitNOFILE=.*/DefaultLimitNOFILE=1000000/' /etc/systemd/system.conf
sudo systemctl daemon-reload
```

Mount the NVMe drives, for example `/mnt/ledger`, `/mnt/accounts`, and `/mnt/snapshots`, and `chown` them to `sol`.

Open the firewall for gossip, TPU/QUIC and repair (the `--dynamic-port-range` below, plus 8001). Keep RPC port 8899 **closed to the internet** on a consensus validator.

## 3. Install Agave

On the validator, as `sol`:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/v4.5.0-beta.0/install)"   # testnet runs the beta line
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
agave-validator --version
```

Mainnet runs the stable line (`v4.4.x` at time of writing). Match the version to the one the cluster announces in the validator Discord or the Anza release notes. The SFDP also sets minimum versions per cluster.

## 4. Create the keys - and keep the important one off the server

There are three keys. Section 4 of the module README explains why they are separate.

```bash
# On the validator server
solana-keygen new -o ~/validator-keypair.json        # identity: hot, lives on the server
solana-keygen new -o ~/vote-account-keypair.json     # vote account address: only needed to create it

# On an air-gapped machine / hardware wallet - NEVER on the validator server
solana-keygen new -o authorized-withdrawer-keypair.json
```

| Key | Lives | If it leaks |
|---|---|---|
| Identity | Validator server (hot) | Attacker can sign blocks as you and **drain the identity balance**. Rotate it (section 8) |
| Vote account keypair | Can be deleted after creation | Nothing: it is just an address once the account exists |
| Authorized withdrawer | **Cold storage** (hardware wallet, multisig, HSM) | Attacker can **withdraw all vote account funds and change authorities**. Catastrophic |

## 5. Fund and create the vote account

Point the CLI at testnet and fund the identity (testnet SOL comes from the testnet faucet or from the SFDP once you enroll):

```bash
solana config set --url https://api.testnet.solana.com --keypair ~/validator-keypair.json
solana airdrop 1        # testnet faucet; rate limited
solana balance
```

Create the vote account. Set the commissions and collectors explicitly instead of taking the defaults:

```bash
solana create-vote-account \
  ~/vote-account-keypair.json \
  ~/validator-keypair.json \
  <AUTHORIZED_WITHDRAWER_PUBKEY> \
  --inflation-rewards-commission-bps 500 \
  --block-revenue-commission-bps 1000
```

- The withdrawer is passed as a **pubkey**. Its private key never touches the server.
- `--inflation-rewards-commission-bps 500` keeps 5% of delegators' inflation rewards.
- `--block-revenue-commission-bps` sets how much of the block revenue (fees) you keep.
- Check what you created with `solana vote-account ~/vote-account-keypair.json`.

### Register the BLS key (required for Alpenglow)

Under Alpenglow, votes are BLS-signed off-chain messages. A validator **without a registered BLS public key is excluded from consensus**. The key is derived from the authorized voter keypair, which is the identity by default:

```bash
solana-keygen bls_pubkey ~/validator-keypair.json
solana vote-authorize-voter-checked ...   # registers the voter + BLS key on the vote account. See the Anza vote-account guide for exact args
solana vote-account ~/vote-account-keypair.json | grep "BLS Public Key"
```

Follow the [Solana BLS / VAT guide](https://solana.com/upgrades/bls-pubkey-vat) and Anza's vote account docs for the exact `vote-authorize-voter-checked` arguments for your CLI version (CLI 4.1.0 or later is required).

### Budget for the Validator Admission Ticket

Every epoch, the VAT is **deducted from the vote account and burned** to admit the validator to the next epoch's consensus. It is currently **0.8 SOL per epoch** on mainnet (SIMD-0357, scaled by SIMD-0525 for 200ms slots). Only the top 2,000 validators by stake are admitted. Keep the vote account funded above rent-exempt plus the VAT, or the validator drops out of consensus for the next epoch and takes several epochs to re-enter. Set up an alert on this balance.

## 6. The startup script

`/home/sol/bin/validator.sh`. The flags come from the [Anza testnet cluster page](https://docs.anza.xyz/clusters/available):

```bash
#!/bin/bash
exec agave-validator \
  --identity /home/sol/validator-keypair.json \
  --vote-account /home/sol/vote-account-keypair.json \
  --known-validator 5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on \
  --known-validator dDzy5SR3AXdYWVqbDEkVFdvSPCtS9ihF5kJkHCtXoFs \
  --known-validator Ft5fbkqNa76vnsjYNwjDZUXoTWpP7VYm3mtsaQckQADN \
  --known-validator eoKpUABi59aT4rR9HGS3LcMecfut9x7zJyodWWP43YQ \
  --known-validator 9QxCLckBiJc783jnMvXZubK4wH86Eqqvashtrwvcsgkv \
  --only-known-rpc \
  --entrypoint entrypoint.testnet.solana.com:8001 \
  --entrypoint entrypoint2.testnet.solana.com:8001 \
  --entrypoint entrypoint3.testnet.solana.com:8001 \
  --expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \
  --ledger /mnt/ledger \
  --accounts /mnt/accounts \
  --snapshots /mnt/snapshots \
  --log /home/sol/agave-validator.log \
  --rpc-port 8899 \
  --rpc-bind-address 127.0.0.1 \
  --private-rpc \
  --dynamic-port-range 8000-8020 \
  --wal-recovery-mode skip_any_corrupted_record \
  --limit-ledger-size
```

What the important flags do:

| Flag | Why |
|---|---|
| `--known-validator` + `--only-known-rpc` | Download the startup snapshot only from trusted nodes, not from a random peer that could serve a poisoned one |
| `--expected-genesis-hash` | Refuse to join if the cluster isn't the one you meant (testnet vs. mainnet) |
| `--entrypoint` | Gossip bootstrap nodes |
| `--ledger` / `--accounts` / `--snapshots` | Put each I/O-heavy store on its own NVMe |
| `--private-rpc` + `--rpc-bind-address 127.0.0.1` | RPC only for local tooling. A consensus validator should not serve public RPC |
| `--limit-ledger-size` | Keep only recent ledger history (about 500 GB by default) instead of growing forever |

For **mainnet**, swap in its entrypoints, known validators and genesis hash (`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`) from the same Anza page.

## 7. Run it under systemd and watch it catch up

`/etc/systemd/system/sol.service`:

```ini
[Unit]
Description=Agave Validator
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=always
RestartSec=1
User=sol
LimitNOFILE=1000000
LimitMEMLOCK=2000000000
LogRateLimitIntervalSec=0
ExecStart=/home/sol/bin/validator.sh

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sol
```

Log rotation (`/etc/logrotate.d/sol`):

```text
/home/sol/agave-validator.log {
  rotate 7
  daily
  missingok
  postrotate
    systemctl kill -s USR1 sol.service
  endscript
}
```

Then watch it start: download a snapshot, replay, and catch up to the cluster tip:

```bash
agave-validator --ledger /mnt/ledger monitor      # live status: slot, health, identity
solana catchup ~/validator-keypair.json           # "has caught up" means you're in sync
solana validators | grep $(solana-keygen pubkey ~/validator-keypair.json)
tail -f ~/agave-validator.log | grep -i -E "error|warn|panic"
```

First startup takes tens of minutes, mostly for the snapshot download and replay. A validator is **delinquent** when it has stopped voting. That is the state delegators and the SFDP watch for.

## 8. Day-2 operations

**Monitoring.** At minimum, alert on:

| Signal | Source | Why |
|---|---|---|
| Delinquent / not voting | `solana validators`, your own metrics | Zero rewards while delinquent; delegators leave |
| Skip rate vs. cluster average | `solana block-production` | Lost fee revenue; SFDP threshold is cluster average + 5 points |
| Slots behind tip | `agave-validator monitor`, `getHealth` | Early warning before delinquency |
| Vote account balance < VAT buffer | `solana balance <vote account>` | Excluded from next epoch's consensus |
| Identity balance | `solana balance` | Pays transaction fees |
| Disk usage / NVMe wear, CPU, RAM, bandwidth | node exporter + Prometheus/Grafana | Most outages are resource exhaustion |

Agave can push metrics to InfluxDB through `SOLANA_METRICS_CONFIG`. Most operators also run [solana-exporter](https://github.com/asymmetric-research/solana-exporter) or similar for Prometheus.

**Upgrades.** Follow the release announcements. Restart during a window when you are not leader, so you don't skip your own slots:

```bash
agave-install init v4.5.0-beta.1    # or the announced version
agave-validator --ledger /mnt/ledger exit --monitor
# systemd restarts it with the new binary
```

`exit` waits for an idle window, with no upcoming leader slots, before stopping.

**Hot-swap failover (identity transfer).** Run a hot spare with an unstaked junk identity. To fail over, copy the voting identity's tower file and switch identities on both machines:

```bash
# on the primary (going down)
agave-validator --ledger /mnt/ledger wait-for-restart-window --min-idle-time 2 --skip-new-snapshot-check
agave-validator --ledger /mnt/ledger set-identity /home/sol/unstaked-identity.json
scp /mnt/ledger/tower-1_9-$(solana-keygen pubkey ~/validator-keypair.json).bin spare:/mnt/ledger/

# on the spare
agave-validator --ledger /mnt/ledger set-identity --require-tower /home/sol/validator-keypair.json
```

> [!NOTE]
> The `tower-*.bin` file is the validator's local record of what it has voted on, so the new machine cannot contradict an earlier vote. Alpenglow changes how votes are stored, so check the current Anza docs for the exact file name and the `set-identity` flags before relying on this procedure.

> [!CAUTION]
> **Never run the same staked identity on two machines at once.** Two nodes voting with one key is the textbook double-vote offence. Automated slashing is **not live** on Solana today, but under Alpenglow a double vote is provable (SIMD-0326), and slashing is planned. Treat it as a fireable offence now.

## 9. RPC node variant

For an RPC node instead of a consensus validator:

- drop `--vote-account` and add `--no-voting`
- replace `--private-rpc` / `--rpc-bind-address 127.0.0.1` with `--full-rpc-api` behind a reverse proxy, with auth and rate limits
- add `--account-index program-id spl-token-owner spl-token-mint` if you need `getProgramAccounts` and token-owner queries. This needs a lot more RAM
- add `--enable-rpc-transaction-history` for `getTransaction` / `getSignaturesForAddress`
- optionally `--geyser-plugin-config` for Yellowstone gRPC (Module 9)

No vote account, no stake and no VAT.

## 10. Joining the SFDP

The [Solana Foundation Delegation Program](https://solana.org/delegation-program) matches outside stake for new operators. Criteria at time of writing (always check [solana.org/delegation-criteria](https://solana.org/delegation-criteria)):

- a testnet validator meeting the baseline in 5 of the last 10 epochs (this runbook gets you there)
- commission at most 5% and Jito MEV commission at most 10%
- skip rate within 5 points of the cluster average
- minimum client versions (Agave 4.4.0+ or Firedancer 26.10.6+ on mainnet; no Frankendancer)
- data-center and ASN concentration limits
- KYC
- since Nov 2026: a 12-month membership with tapering vote-cost coverage, and exit once outside stake passes a threshold
