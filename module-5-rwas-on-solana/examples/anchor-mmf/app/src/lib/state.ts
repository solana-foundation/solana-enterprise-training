import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { PERSONA_KEYS, PersonaKey, RoleKey, roleKeyFromBytes, TIMELOCK_DELAY, TimeLockOp } from "./constants";
import type { Env } from "./env";
import { getChainTime } from "./chain";
import { pdas } from "./names";
import type { Programs } from "./programs";

export interface HolderState {
  wallet: PublicKey;
  sol: number;
  ata: PublicKey;
  ataExists: boolean;
  frozen: boolean;
  amount: bigint;
  allowlisted: boolean;
  rateLimit: { used: bigint; windowStart: number } | null;
}

export type ProposalStatus = "proposed" | "accepted" | "executed" | "cancelled";

export interface Proposal {
  address: PublicKey;
  op: TimeLockOp;
  actionData: Uint8Array;
  proposer: PublicKey;
  responder: PublicKey | null;
  executer: PublicKey | null;
  status: ProposalStatus;
  /** Creation time while proposed; acceptance time once accepted. */
  timestamp: number;
  readyAt: number | null;
}

export interface RoleGrant {
  address: PublicKey;
  role: RoleKey | undefined;
  grantee: PublicKey;
  granted: boolean;
}

export interface FundState {
  /** Wall-clock ms when this was fetched, for ticking countdowns locally. */
  fetchedAt: number;
  /** Chain unix time (seconds) at fetch. */
  now: number;
  initialized: boolean;
  config: { admin: PublicKey; version: bigint } | null;
  mint: { supply: bigint; paused: boolean } | null;
  rateConfig: { maxAmount: bigint; window: number; authority: PublicKey } | null;
  roles: RoleGrant[];
  proposals: Proposal[];
  holders: Record<PersonaKey, HolderState>;
}

// Token-2022 mint layout: 82-byte base mint, padded to 165, then the account
// type byte, then TLV extensions (u16 type, u16 length, value).
const EXT_PAUSABLE = 26;

function findExtension(data: Uint8Array, type: number): Uint8Array | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = 166;
  while (i + 4 <= data.length) {
    const t = view.getUint16(i, true);
    const len = view.getUint16(i + 2, true);
    if (t === type) return data.subarray(i + 4, i + 4 + len);
    if (t === 0 && len === 0) break;
    i += 4 + len;
  }
  return null;
}

function decodeMint(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const supply = view.getBigUint64(36, true);
  // Pausable: authority (32) + paused (1).
  const pausable = findExtension(data, EXT_PAUSABLE);
  return { supply, paused: pausable ? pausable[32] === 1 : false };
}

// Token account layout: amount u64 at 64, state byte at 108 (1 = initialized, 2 = frozen).
function decodeTokenAccount(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { amount: view.getBigUint64(64, true), frozen: data[108] === 2 };
}

const variant = (o: object) => Object.keys(o)[0];
const toBig = (n: { toString(): string }) => BigInt(n.toString());

export async function loadFund(conn: Connection, programs: Programs, env: Env): Promise<FundState> {
  const { mint, listConfig, personas } = env;
  const wallets = PERSONA_KEYS.map((k) => personas[k].publicKey);
  const atas = wallets.map((w) => pdas.ata(w, mint));
  const entries = wallets.map((w) => pdas.walletEntry(listConfig, w));
  const limits = wallets.map((w) => pdas.rateLimit(mint, w));

  const [now, raw, config, rateConfig, roleAccts, lockAccts, rateLimits] = await Promise.all([
    getChainTime(conn),
    conn.getMultipleAccountsInfo([mint, ...wallets, ...atas, ...entries], "confirmed"),
    programs.admin.account.config.fetchNullable(pdas.config(), "confirmed"),
    programs.hook.account.rateLimitConfig.fetchNullable(pdas.rateConfig(mint), "confirmed"),
    programs.admin.account.role.all(),
    programs.admin.account.timeLock.all(),
    programs.hook.account.rateLimit.fetchMultiple(limits, "confirmed"),
  ]);

  const n = wallets.length;
  const mintInfo = raw[0];
  const holders = {} as Record<PersonaKey, HolderState>;
  PERSONA_KEYS.forEach((k, i) => {
    const walletInfo = raw[1 + i];
    const ataInfo = raw[1 + n + i];
    const entryInfo = raw[1 + 2 * n + i];
    const tok = ataInfo ? decodeTokenAccount(ataInfo.data) : null;
    const rl = rateLimits[i];
    holders[k] = {
      wallet: wallets[i],
      sol: (walletInfo?.lamports ?? 0) / LAMPORTS_PER_SOL,
      ata: atas[i],
      ataExists: !!ataInfo,
      frozen: tok?.frozen ?? false,
      amount: tok?.amount ?? 0n,
      allowlisted: !!entryInfo,
      rateLimit: rl ? { used: toBig(rl.amountTransferred), windowStart: Number(rl.lastUpdated) } : null,
    };
  });

  const proposals: Proposal[] = lockAccts
    .map(({ publicKey, account: a }) => {
      const op = variant(a.operation) as TimeLockOp;
      const status = variant(a.status) as ProposalStatus;
      const timestamp = Number(a.timestamp);
      return {
        address: publicKey,
        op,
        actionData: Uint8Array.from(a.actionData),
        proposer: a.proposer,
        responder: a.responder,
        executer: a.executer,
        status,
        timestamp,
        readyAt: status === "accepted" || status === "executed" ? timestamp + TIMELOCK_DELAY[op] : null,
      };
    })
    .sort((x, y) => y.timestamp - x.timestamp);

  const roles: RoleGrant[] = roleAccts.map(({ publicKey, account: a }) => ({
    address: publicKey,
    role: roleKeyFromBytes(a.role),
    grantee: a.grantee,
    granted: a.granted,
  }));

  return {
    fetchedAt: Date.now(),
    now,
    initialized: !!config,
    config: config ? { admin: config.admin, version: toBig(config.version) } : null,
    mint: mintInfo ? decodeMint(mintInfo.data) : null,
    rateConfig: rateConfig
      ? { maxAmount: toBig(rateConfig.maxAmount), window: Number(rateConfig.window), authority: rateConfig.authority }
      : null,
    roles,
    proposals,
    holders,
  };
}

/** Amount the holder has sent in the current window, accounting for a lapsed window. */
export function usedThisWindow(h: HolderState, fund: FundState, now: number): bigint {
  if (!h.rateLimit || !fund.rateConfig) return 0n;
  return now >= h.rateLimit.windowStart + fund.rateConfig.window ? 0n : h.rateLimit.used;
}
