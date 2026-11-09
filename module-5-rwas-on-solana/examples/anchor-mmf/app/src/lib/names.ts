import { PublicKey } from "@solana/web3.js";
import {
  ATA_PROGRAM_ID,
  GATE_ID,
  HOOK_ID,
  MMF_ADMIN_ID,
  PROGRAM_NAMES,
  ROLE_IDS,
  RoleKey,
  TOKEN_2022_ID,
  TOKEN_ACL_ID,
} from "./constants";

// Address book for the inspector: every PDA derived through `pdas` records
// its seeds, and every well-known address gets a human name.

export type SeedPart = string | PublicKey;
export interface PdaInfo {
  program: string;
  seeds: SeedPart[];
}

const pdaInfo = new Map<string, PdaInfo>();
const names = new Map<string, string>(Object.entries(PROGRAM_NAMES));

export function setName(key: PublicKey, name: string) {
  names.set(key.toBase58(), name);
}

export function nameOf(key: PublicKey | string): string | undefined {
  return names.get(typeof key === "string" ? key : key.toBase58());
}

export function pdaOf(key: PublicKey | string): PdaInfo | undefined {
  return pdaInfo.get(typeof key === "string" ? key : key.toBase58());
}

export function short(key: PublicKey | string): string {
  const s = typeof key === "string" ? key : key.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** Name if known, otherwise a shortened address. */
export function label(key: PublicKey | string): string {
  return nameOf(key) ?? short(key);
}

type Seed = { bytes: Uint8Array; show: SeedPart };
const text = (s: string): Seed => ({ bytes: new TextEncoder().encode(s), show: `"${s}"` });
const key = (k: PublicKey): Seed => ({ bytes: k.toBytes(), show: k });

function derive(program: PublicKey, seeds: Seed[]): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    seeds.map((s) => s.bytes),
    program,
  );
  pdaInfo.set(address.toBase58(), {
    program: PROGRAM_NAMES[program.toBase58()] ?? short(program),
    seeds: seeds.map((s) => s.show),
  });
  return address;
}

function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

export const pdas = {
  // mmf_admin
  config: () => derive(MMF_ADMIN_ID, [text("mmf-config")]),
  role: (role: RoleKey, grantee: PublicKey) =>
    derive(MMF_ADMIN_ID, [text("mmf-role"), { bytes: ROLE_IDS[role], show: role }, key(grantee)]),
  timelock: (seed: bigint, proposer: PublicKey) =>
    derive(MMF_ADMIN_ID, [{ bytes: u64le(seed), show: `seed ${seed}` }, key(proposer)]),
  eventAuthority: () => derive(MMF_ADMIN_ID, [text("__event_authority")]),

  // mmf_transfer_hook
  rateConfig: (mint: PublicKey) => derive(HOOK_ID, [text("mmf-rate-config"), key(mint)]),
  rateLimit: (mint: PublicKey, owner: PublicKey) => derive(HOOK_ID, [text("mmf-rate-limit"), key(mint), key(owner)]),
  extraMetas: (mint: PublicKey) => derive(HOOK_ID, [text("extra-account-metas"), key(mint)]),

  // Token ACL + ABL gate
  mintConfig: (mint: PublicKey) => derive(TOKEN_ACL_ID, [text("MINT_CONFIG"), key(mint)]),
  flag: (tokenAccount: PublicKey) => derive(TOKEN_ACL_ID, [text("FLAG_ACCOUNT"), key(tokenAccount)]),
  thawExtraMetas: (mint: PublicKey) => derive(GATE_ID, [text("thaw_extra_account_metas"), key(mint)]),
  listConfig: (authority: PublicKey, seed: Uint8Array) =>
    derive(GATE_ID, [text("list_config"), key(authority), { bytes: seed, show: "list seed" }]),
  walletEntry: (listConfig: PublicKey, wallet: PublicKey) =>
    derive(GATE_ID, [text("wallet_entry"), key(listConfig), key(wallet)]),

  // Associated token account (Token-2022 flavour)
  ata: (owner: PublicKey, mint: PublicKey) => derive(ATA_PROGRAM_ID, [key(owner), key(TOKEN_2022_ID), key(mint)]),
};
