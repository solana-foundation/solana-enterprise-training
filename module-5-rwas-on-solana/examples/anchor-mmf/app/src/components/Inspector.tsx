import { PublicKey } from "@solana/web3.js";
import { MMF_ADMIN_ID, PERSONA_LABEL, TOKEN_ACL_ID } from "../lib/constants";
import type { TxRecord } from "../lib/chain";
import { label, nameOf, pdaOf, short, type SeedPart } from "../lib/names";
import { useStore } from "../store";
import { Pill } from "./ui";

function seedText(parts: SeedPart[]): string {
  return parts.map((p) => (p instanceof PublicKey ? label(p) : p)).join(", ");
}

/** Replaces program ids in log lines with their names. */
function prettyLog(line: string): string {
  return line.replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (m) => nameOf(m) ?? short(m));
}

/** The call tree from the logs: which programs ran, and at what depth. */
function trace(logs: string[]): { name: string; depth: number; ok: boolean }[] {
  const out: { name: string; depth: number; ok: boolean }[] = [];
  const stack: number[] = [];
  for (const l of logs) {
    const inv = l.match(/^Program (\w+) invoke \[(\d+)\]/);
    if (inv) {
      stack.push(out.length);
      out.push({ name: nameOf(inv[1]) ?? short(inv[1]), depth: Number(inv[2]), ok: true });
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(l)) {
      const i = stack.pop();
      if (i !== undefined && l.includes("failed")) out[i].ok = false;
    }
  }
  return out;
}

function Detail({ rec }: { rec: TxRecord }) {
  const { env } = useStore();
  const calls = trace(rec.logs);
  const touchesAcl = rec.ixs.some((i) => i.programId === TOKEN_ACL_ID.toBase58());
  const touchesAdmin = calls.some((c) => c.name === "mmf_admin") || rec.ixs.some((i) => i.programId === MMF_ADMIN_ID.toBase58());
  const explorer = rec.signature
    ? `https://explorer.solana.com/tx/${rec.signature}?cluster=custom&customUrl=${encodeURIComponent(env.rpcUrl)}`
    : null;

  return (
    <div className="detail">
      <div className="stack">
        <div className="row">
          <h3>{rec.title}</h3>
        </div>
        <div className="row small">
          {rec.kind === "cheat" ? (
            <Pill tone="warn">localnet cheatcode</Pill>
          ) : rec.ok ? (
            <Pill tone="ok">confirmed</Pill>
          ) : rec.landed ? (
            <Pill tone="bad">failed on chain</Pill>
          ) : (
            <Pill tone="bad">rejected in simulation</Pill>
          )}
          {rec.as && <span className="muted">signed by {PERSONA_LABEL[rec.as]}</span>}
          {explorer && (
            <a className="muted" href={explorer} target="_blank" rel="noreferrer">
              Explorer
            </a>
          )}
        </div>
      </div>

      {rec.note && <div className="note accent">{rec.note}</div>}

      {rec.error && (
        <div className="result bad">
          <div className="t">
            <span className="name">{rec.error.name}</span>
            {rec.error.program && <span className="small muted">from {rec.error.program}</span>}
          </div>
          <span className="small">{rec.error.message}</span>
          {rec.error.hint && <span className="small">{rec.error.hint}</span>}
        </div>
      )}

      {touchesAcl && !touchesAdmin && (
        <div className="note">mmf_admin is not in this transaction. Compliance gating is the external Token ACL standard, not issuer code.</div>
      )}

      {calls.length > 0 && (
        <div className="stack">
          <span className="overline">Programs that ran</span>
          <div className="trace">
            {calls.map((c, i) => (
              <div key={i} style={{ paddingLeft: (c.depth - 1) * 16 }}>
                {c.depth > 1 ? "↳ " : ""}
                {c.name}
                {c.depth > 1 ? " (CPI)" : ""} {c.ok ? "" : <span style={{ color: "var(--bad)" }}>failed</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {rec.ixs.map((ix, n) => (
        <div className="ixblock" key={n}>
          <div className="ixhead">
            <span className="overline">Instruction {n + 1}</span>
            <b>{ix.program}</b>
            <code>{ix.name}</code>
          </div>
          <div>
            {ix.accounts.map((a, i) => {
              const pda = pdaOf(a.address);
              return (
                <div className="acct" key={i}>
                  <span className="who">
                    <span className="nm">{a.name}</span>
                    <br />
                    {nameOf(a.address) ?? <code>{short(a.address)}</code>}
                  </span>
                  <span className="flags">
                    {a.signer && <span className="flag s">signer</span>}
                    {a.writable && <span className="flag w">mut</span>}
                    {pda && <span className="flag p">PDA</span>}
                  </span>
                  {pda && (
                    <span className="seed">
                      [{seedText(pda.seeds)}] · {pda.program}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {rec.logs.length > 0 && (
        <div className="stack">
          <span className="overline">Logs</span>
          <div className="logs">
            {rec.logs.map((l, i) => (
              <div key={i} className={/ invoke \[/.test(l) ? "inv" : /failed|Error/.test(l) ? "err" : undefined}>
                {prettyLog(l)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Inspector() {
  const { txs, selected, select } = useStore();
  return (
    <aside className="inspector" aria-label="Transaction inspector">
      <div className="insp-head">
        <h3>Inspector</h3>
        <span className="small muted">every account, seed and log line</span>
      </div>
      {txs.length === 0 ? (
        <div className="detail">
          <p className="muted">
            Run any action and its transaction opens here: the instructions, every account passed in with the seeds that
            derive each PDA, which programs ran, and the logs. Rejections show up too, with the error decoded.
          </p>
        </div>
      ) : (
        <>
          <div className="history">
            {txs.map((t) => (
              <button key={t.id} aria-current={selected?.id === t.id} onClick={() => select(t.id)}>
                <span className={`s ${t.kind === "cheat" ? "cheat" : t.ok ? "ok" : "bad"}`} />
                <span className="ttl">{t.title}</span>
                <span className="muted">{t.ok ? "" : t.error?.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
          {selected && <Detail rec={selected} />}
        </>
      )}
    </aside>
  );
}
