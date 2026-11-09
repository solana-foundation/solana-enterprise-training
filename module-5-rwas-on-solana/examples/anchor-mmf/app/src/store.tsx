import { Connection, PublicKey } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cheatRecord, sendIxs, timeTravel, type TxRecord } from "./lib/chain";
import { PersonaKey } from "./lib/constants";
import type { Env } from "./lib/env";
import { fmtChainTime } from "./lib/format";
import type { Ix } from "./lib/instructions";
import { makePrograms, type Programs } from "./lib/programs";
import { loadFund, type FundState } from "./lib/state";

export interface Store {
  env: Env;
  conn: Connection;
  programs: Programs;
  fund: FundState | null;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** The persona whose keypair signs. */
  active: PersonaKey;
  setActive: (k: PersonaKey) => void;
  key: (k: PersonaKey) => PublicKey;
  txs: TxRecord[];
  selected: TxRecord | null;
  select: (id: string) => void;
  busy: string | null;
  run: (title: string, as: PersonaKey, build: () => Promise<Ix[]> | Ix[]) => Promise<TxRecord>;
  fastForward: (toUnix: number, title: string) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function StoreProvider({ env, children }: { env: Env; children: ReactNode }) {
  const conn = useMemo(() => new Connection(env.rpcUrl, "confirmed"), [env]);
  const programs = useMemo(() => makePrograms(conn), [conn]);
  const [fund, setFund] = useState<FundState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<PersonaKey>("admin");
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [selectedId, select] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Coalesce overlapping refreshes: if one is running, run once more after it.
  const loading = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current) {
      again.current = true;
      return loading.current;
    }
    const go = async () => {
      do {
        again.current = false;
        try {
          setFund(await loadFund(conn, programs, env));
          setLoadError(null);
        } catch (e) {
          setLoadError(message(e));
        }
      } while (again.current);
    };
    loading.current = go().finally(() => (loading.current = null));
    return loading.current;
  }, [conn, programs, env]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const push = useCallback((rec: TxRecord) => {
    rec.screen = location.hash.replace("#", "") || "dashboard";
    setTxs((list) => [rec, ...list].slice(0, 60));
    select(rec.id);
  }, []);

  const run = useCallback<Store["run"]>(
    async (title, as, build) => {
      setBusy(title);
      try {
        let ixs: Ix[];
        try {
          ixs = await build();
        } catch (e) {
          const rec: TxRecord = {
            ...cheatRecord(title, "", false),
            kind: "tx",
            as,
            error: { name: "Not sent", message: message(e) },
          };
          push(rec);
          return rec;
        }
        const rec = await sendIxs(conn, title, ixs, [env.personas[as]], as);
        push(rec);
        await refresh();
        return rec;
      } finally {
        setBusy(null);
      }
    },
    [conn, env, push, refresh],
  );

  const fastForward = useCallback<Store["fastForward"]>(
    async (toUnix, title) => {
      setBusy(title);
      try {
        await timeTravel(env.rpcUrl, toUnix);
        // Let a slot pass so the next transaction sees the new clock.
        await new Promise((r) => setTimeout(r, 1200));
        push(
          cheatRecord(
            title,
            `surfnet_timeTravel moved the localnet clock to ${fmtChainTime(toUnix)}. This is a Surfpool cheatcode: on a real cluster the delay has to pass.`,
          ),
        );
        await refresh();
      } catch (e) {
        push(cheatRecord(title, message(e), false));
      } finally {
        setBusy(null);
      }
    },
    [env, push, refresh],
  );

  const value: Store = {
    env,
    conn,
    programs,
    fund,
    loadError,
    refresh,
    active,
    setActive,
    key: (k) => env.personas[k].publicKey,
    txs,
    selected: txs.find((t) => t.id === selectedId) ?? txs[0] ?? null,
    select,
    busy,
    run,
    fastForward,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Chain time that keeps ticking between refreshes. */
export function useChainNow(): number {
  const { fund } = useStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!fund) return Math.floor(Date.now() / 1000);
  return Math.floor(fund.now + (Date.now() - fund.fetchedAt) / 1000);
}
