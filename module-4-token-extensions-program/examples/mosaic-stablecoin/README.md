# Mosaic Enterprise Stablecoin Demo

A working demonstration of how to issue and manage a **compliance-ready stablecoin** on Solana using the [Mosaic SDK](https://github.com/solana-foundation/mosaic) from the Solana Foundation.

This project shows enterprise compliance officers and engineering teams how Solana's Token-2022 program - wrapped by Mosaic - provides the same regulatory controls found in traditional financial infrastructure, but enforced on-chain and auditable by anyone.

---

## What This Demo Covers

| Script | What it does | Compliance feature |
|--------|-------------|-------------------|
| `01-create-stablecoin.ts` | Creates a new stablecoin mint with all compliance extensions | Token creation with Metadata, Pausable, Confidential Balances, Permanent Delegate, sRFC-37 blocklist |
| `02-mint-tokens.ts` | Mints tokens to a recipient wallet | Automatic ATA creation, sRFC-37 thaw handling |
| `03-blocklist-address.ts` | Adds a wallet to the on-chain blocklist and freezes it | OFAC / sanctions screening - atomic blocklist add + freeze |
| `04-force-transfer.ts` | Seizes tokens from any wallet without owner approval | Court-ordered asset seizure via Permanent Delegate |
| `05-pause-token.ts` | Halts all token transfers globally | Emergency circuit breaker for incident response |
| `06-inspect-token.ts` | Reads full on-chain state for audit | Compliance audit - all authorities and extensions visible |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR APPLICATION                         │
├─────────────────────────────────────────────────────────────────┤
│                    @solana/mosaic-sdk                            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  Templates   │  │  Management  │  │    Inspection       │    │
│  │  (Stablecoin │  │  (Mint, Burn │  │    (Audit, Read     │    │
│  │   Arcade,    │  │   Pause,     │  │     on-chain state) │    │
│  │   Security)  │  │   Blocklist)  │  │                     │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  Token ACL (sRFC-37)    │    ABL (Allow / Block lists)           │
├─────────────────────────────────────────────────────────────────┤
│                  Solana Token-2022 Program                       │
│  Metadata · Pausable · ConfidentialBalances · PermanentDelegate │
│  DefaultAccountState · TransferFee · ScaledUiAmount             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- **Node.js** 20+
- **Solana CLI** installed (`solana --version`)
- A funded **devnet wallet** (`solana airdrop 2 --url devnet`)

### 1. Clone and install

```bash
git clone <this-repo>
cd mosaic-stablecoin-demo
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your authority keypair. You can export it from a Solana CLI keypair file:

```bash
# If you have a keypair JSON file (e.g. ~/.config/solana/id.json):
AUTHORITY_PRIVATE_KEY=$(cat ~/.config/solana/id.json)
```

### 3. Run the scripts in order

```bash
# Step 1: Create the stablecoin (save the MINT_ADDRESS output to .env)
npm run create-token

# Step 2: Mint tokens to a recipient
#   → Set RECIPIENT_ADDRESS in .env first
npm run mint-tokens

# Step 3: Blocklist a sanctioned wallet
#   → Set SANCTIONED_WALLET in .env first
npm run blocklist

# Step 4: Force-transfer (seize) tokens from the sanctioned wallet
#   → Set RECOVERY_WALLET in .env first
npm run force-transfer

# Step 4: Force-transfer (seize) tokens from the sanctioned wallet
#   → Set RECOVERY_WALLET in .env first
npm run force-transfer

# Step 5: Pause all token operations
npm run pause-token
# Resume: npx tsx src/05-pause-token.ts resume

# Step 6: Inspect the token's on-chain state
npm run inspect-token
```

---

## Key Compliance Features Explained

### Blocklist (sRFC-37)

When the stablecoin is created with `enableSrfc37: true` and `aclMode: "blocklist"`, all new token accounts start in an active (unfrozen) state, and the mint's freeze authority is handed to the Token ACL program's config PDA. The issuer (as Token ACL config authority) can add any wallet to the blocklist at any time and freeze that wallet's token account in the same transaction. Blocklisted wallets cannot send, receive, or interact with the token until they are removed from the list.

This maps directly to OFAC sanctions compliance: flag a wallet, and it is immediately frozen on-chain.

### Permanent Delegate (Asset Seizure)

The Permanent Delegate extension gives the issuer authority to transfer or burn tokens from **any** token account - without the account owner's signature. This is the on-chain equivalent of a bank freeze + asset seizure order.

Use cases: court-ordered clawbacks, recovery from compromised wallets, regulatory-mandated liquidation.

### Pausable (Emergency Stop)

The Pausable extension allows the issuer to halt **all** token operations globally - transfers, minting, burning - with a single transaction. This is a critical circuit breaker for security incidents, regulatory holds, or coordinated maintenance windows.

### Confidential Balances

Token account balances are encrypted on-chain. Only the account owner (and the confidential balances authority) can decrypt them. This provides privacy for holders while maintaining the issuer's ability to audit.

---

## Technology Stack

- **Solana Token-2022** - the on-chain token program with extension support
- **Mosaic SDK** (`@solana/mosaic-sdk`) - high-level TypeScript SDK wrapping Token-2022
- **sRFC-37** - Solana Request for Comment for permissioned tokens (Token ACL + ABL programs)
- **Solana Kit** (`@solana/kit` v5) - modern Solana TypeScript client

---

## For Enterprise Evaluation

This demo is designed to answer the question: *"Can Solana support the compliance controls we need for a regulated token?"*

The answer is yes. Every control demonstrated here - sanctions freezing, asset seizure, emergency pause, confidential balances, authority management - is enforced at the **protocol level** by the Token-2022 program. These are not application-layer workarounds; they are native Solana primitives.

Key points for evaluation:

- **All authorities are on-chain and auditable.** Run `inspect-token` to see exactly who controls what.
- **Deny-list enforcement is atomic.** A single transaction adds to the list and freezes the account.
- **Asset seizure requires no owner cooperation.** The Permanent Delegate can move tokens unilaterally.
- **Emergency pause is instant and global.** One transaction halts all operations.
- **Everything runs on Solana devnet today.** No custom programs needed - Mosaic uses standard Token-2022 extensions.

---

## Resources

- [Mosaic SDK on GitHub](https://github.com/solana-foundation/mosaic)
- [Token-2022 Extensions Guide](https://solana.com/docs/tokens/extensions)
- [sRFC-37: Permissioned Tokens](https://solana.com/developers/guides/advanced/acl)
- [Permanent Delegate Extension](https://solana.com/developers/guides/token-extensions/permanent-delegate)

---

## License

MIT
