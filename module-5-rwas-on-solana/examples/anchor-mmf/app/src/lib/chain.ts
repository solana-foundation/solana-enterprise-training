import { Connection, Keypair, SendTransactionError, Transaction } from "@solana/web3.js";
import { CLOCK_SYSVAR_ID, PersonaKey, PROGRAM_NAMES } from "./constants";
import { decodeError, type DecodedError } from "./errors";
import type { Ix } from "./instructions";

export interface AccountView {
  name: string;
  address: string;
  signer: boolean;
  writable: boolean;
}

export interface IxView {
  program: string;
  programId: string;
  name: string;
  accounts: AccountView[];
  dataLen: number;
}

/** One entry in the inspector: a transaction, or a localnet cheatcode. */
export interface TxRecord {
  id: string;
  kind: "tx" | "cheat";
  title: string;
  as?: PersonaKey;
  ok: boolean;
  signature?: string;
  /** False when preflight simulation rejected it, so nothing landed. */
  landed: boolean;
  /** Console screen the action was run from. */
  screen?: string;
  ixs: IxView[];
  logs: string[];
  error?: DecodedError;
  note?: string;
  at: number;
}

let counter = 0;
const nextId = () => `${Date.now()}-${counter++}`;

function viewOf(ixs: Ix[]): IxView[] {
  return ixs.map(({ ix, program, name, accounts }) => ({
    program,
    programId: ix.programId.toBase58(),
    name,
    dataLen: ix.data.length,
    accounts: ix.keys.map((k, i) => ({
      name: accounts[i] ?? `remaining ${i - accounts.length}`,
      address: k.pubkey.toBase58(),
      signer: k.isSigner,
      writable: k.isWritable,
    })),
  }));
}

/**
 * Signs with the given keypairs (the first one pays), sends with preflight,
 * and returns everything the inspector shows. Never throws for on-chain
 * failures: a rejected transaction is a result worth showing.
 */
export async function sendIxs(
  conn: Connection,
  title: string,
  ixs: Ix[],
  signers: Keypair[],
  as?: PersonaKey,
): Promise<TxRecord> {
  const base = { id: nextId(), kind: "tx" as const, title, as, ixs: viewOf(ixs), at: Date.now() };
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight });
  tx.add(...ixs.map((i) => i.ix));
  tx.sign(...signers);

  let signature: string | undefined;
  try {
    signature = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
    const conf = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    const detail = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const logs = detail?.meta?.logMessages ?? [];
    if (conf.value.err) {
      const raw = JSON.stringify(conf.value.err);
      return { ...base, ok: false, landed: true, signature, logs, error: decodeError(logs, raw) };
    }
    return { ...base, ok: true, landed: true, signature, logs };
  } catch (e) {
    let logs: string[] = [];
    let raw = e instanceof Error ? e.message : String(e);
    if (e instanceof SendTransactionError) {
      logs = e.logs ?? (await e.getLogs(conn).catch(() => [])) ?? [];
      raw = e.transactionError?.message ?? raw;
    }
    return { ...base, ok: false, landed: false, signature, logs, error: decodeError(logs, raw) };
  }
}

/** Unix time as programs see it: `Clock::unix_timestamp`. */
export async function getChainTime(conn: Connection): Promise<number> {
  const info = await conn.getAccountInfo(CLOCK_SYSVAR_ID, "confirmed");
  if (!info) throw new Error("Clock sysvar not found");
  return Number(Buffer.from(info.data).readBigInt64LE(32));
}

/**
 * Surfpool cheatcode: moves the localnet clock forward. Only Surfpool
 * supports it; a normal validator (or mainnet) cannot skip a timelock.
 */
export async function timeTravel(rpcUrl: string, unixSeconds: number): Promise<void> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_timeTravel",
      params: [{ absoluteTimestamp: unixSeconds * 1000 }],
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.data ?? body.error.message ?? "surfnet_timeTravel failed");
}

export function cheatRecord(title: string, note: string, ok = true): TxRecord {
  return { id: nextId(), kind: "cheat", title, ok, landed: ok, ixs: [], logs: [], note, at: Date.now() };
}

export function programName(id: string): string {
  return PROGRAM_NAMES[id] ?? `${id.slice(0, 4)}…${id.slice(-4)}`;
}
