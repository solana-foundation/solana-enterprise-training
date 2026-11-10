import { PublicKey } from "@solana/web3.js";
import { useState } from "react";
import {
  HOLDER_KEYS,
  OP_LABEL,
  PERSONA_KEYS,
  PERSONA_LABEL,
  PersonaKey,
  ROLE_KEYS,
  RoleKey,
  roleKeyFromBytes,
  TIMELOCK_DELAY,
  HolderKey,
} from "../lib/constants";
import { fmtAmount, fmtDuration, fmtWindow, parseAmount } from "../lib/format";
import * as ix from "../lib/instructions";
import type { Ix } from "../lib/instructions";
import { label, pdas } from "../lib/names";
import type { Proposal } from "../lib/state";
import { Action, AmountField, HolderSelect, LastResult, ScreenHead } from "../components/ui";
import { useChainNow, useStore } from "../store";

type Decoded =
  | { kind: "forceTransfer"; from: PublicKey; to: PublicKey; amount: bigint }
  | { kind: "forceBurn"; from: PublicKey; amount: bigint }
  | { kind: "setRole"; role: RoleKey | undefined; roleBytes: Uint8Array; grantee: PublicKey; granted: boolean }
  | { kind: "other" };

const u64At = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(o, true);

function decode(p: Proposal): Decoded {
  const d = p.actionData;
  if (p.op === "forceTransfer" && d.length === 72)
    return { kind: "forceTransfer", from: new PublicKey(d.subarray(0, 32)), to: new PublicKey(d.subarray(32, 64)), amount: u64At(d, 64) };
  if (p.op === "forceBurn" && d.length === 40) return { kind: "forceBurn", from: new PublicKey(d.subarray(0, 32)), amount: u64At(d, 32) };
  if (p.op === "setRole" && d.length === 65)
    return { kind: "setRole", role: roleKeyFromBytes(d.subarray(0, 32)), roleBytes: d.subarray(0, 32), grantee: new PublicKey(d.subarray(32, 64)), granted: d[64] === 1 };
  return { kind: "other" };
}

function describe(d: Decoded): string[] {
  switch (d.kind) {
    case "forceTransfer":
      return [`${fmtAmount(d.amount)} MMF`, `${label(d.from)} → ${label(d.to)}`];
    case "forceBurn":
      return [`${fmtAmount(d.amount)} MMF`, `from ${label(d.from)}`];
    case "setRole":
      return [`${d.granted ? "Grant" : "Revoke"} ${d.role ?? "unknown role"}`, `${d.granted ? "to" : "from"} ${label(d.grantee)}`];
    default:
      return ["(not supported by the console)"];
  }
}

type FormOp = "forceTransfer" | "forceBurn" | "grant" | "revoke";

export function Timelock() {
  const { fund, env, programs: p, key, fastForward, busy } = useStore();
  const now = useChainNow();
  const [op, setOp] = useState<FormOp>("forceTransfer");
  const [from, setFrom] = useState<HolderKey>("holderA");
  const [to, setTo] = useState<HolderKey>("admin");
  const [amount, setAmount] = useState("120");
  const [role, setRole] = useState<RoleKey>("MINTER");
  const [grantee, setGrantee] = useState<PersonaKey>("holderB");
  if (!fund) return null;
  const { mint } = env;
  const ata = (k: PersonaKey) => pdas.ata(key(k), mint);
  const parsed = parseAmount(amount);

  const proposal = (): { op: Parameters<typeof ix.createProposal>[3]; data: Buffer; title: string } => {
    if (op === "forceTransfer") {
      if (!parsed) throw new Error("Enter an amount.");
      return { op, data: ix.encodeAction.forceTransfer(ata(from), ata(to), parsed), title: `Propose force transfer of ${fmtAmount(parsed)} MMF` };
    }
    if (op === "forceBurn") {
      if (!parsed) throw new Error("Enter an amount.");
      return { op, data: ix.encodeAction.forceBurn(ata(from), parsed), title: `Propose force burn of ${fmtAmount(parsed)} MMF` };
    }
    const granted = op === "grant";
    return { op: "setRole", data: ix.encodeAction.setRole(role, key(grantee), granted), title: `Propose ${granted ? "granting" : "revoking"} ${role}` };
  };

  // The edited execution changes one parameter, which is what the binding catches.
  function executeIxs(prop: Proposal, as: PersonaKey, edited: boolean): Promise<Ix>[] {
    const d = decode(prop);
    if (d.kind === "forceTransfer") {
      const other = HOLDER_KEYS.map(ata).find((a) => !a.equals(d.from) && !a.equals(d.to))!;
      return [ix.forceTransfer(p, key(as), mint, prop.address, d.from, edited ? other : d.to, d.amount)];
    }
    if (d.kind === "forceBurn") return [ix.forceBurn(p, key(as), mint, prop.address, d.from, edited ? d.amount * 2n : d.amount)];
    if (d.kind === "setRole" && d.role) {
      const other = PERSONA_KEYS.map(key).find((k) => !k.equals(d.grantee))!;
      return [ix.setRole(p, key(as), edited ? other : d.grantee, d.role, d.granted, prop.address)];
    }
    throw new Error("The console cannot execute this operation.");
  }

  function editLabel(prop: Proposal): string {
    const d = decode(prop);
    if (d.kind === "forceTransfer") {
      const other = HOLDER_KEYS.map(ata).find((a) => !a.equals(d.from) && !a.equals(d.to))!;
      return `to ${label(other)} instead`;
    }
    if (d.kind === "forceBurn") return `double the amount`;
    if (d.kind === "setRole") return `for a different grantee`;
    return "";
  }

  const columns: { title: string; items: Proposal[] }[] = [
    { title: "Proposed", items: fund.proposals.filter((x) => x.status === "proposed") },
    { title: "Accepted, waiting", items: fund.proposals.filter((x) => x.status === "accepted" && now < (x.readyAt ?? 0)) },
    { title: "Ready to execute", items: fund.proposals.filter((x) => x.status === "accepted" && now >= (x.readyAt ?? 0)) },
    { title: "Done", items: fund.proposals.filter((x) => x.status === "executed" || x.status === "cancelled") },
  ];

  return (
    <div className="screen">
      <ScreenHead title="Timelock">
        Maker/checker: the Admin proposes, a different key approves, a delay runs, then the Admin executes. The proposal stores
        the exact parameters, and execution is rejected if any of them change.
      </ScreenHead>
      <LastResult />

      <div className="card">
        <div className="card-head">
          <h3>New proposal</h3>
          <p>
            Force actions wait {fmtWindow(TIMELOCK_DELAY.forceTransfer)} after approval, role changes {fmtWindow(TIMELOCK_DELAY.setRole)}. The
            proposer needs COMPLIANCE_DELEGATE for force actions.
          </p>
        </div>
        <div className="row" style={{ alignItems: "end" }}>
          <label className="field" htmlFor="tl-op">
            Operation
            <select id="tl-op" value={op} onChange={(e) => setOp(e.target.value as FormOp)}>
              <option value="forceTransfer">Force transfer</option>
              <option value="forceBurn">Force burn</option>
              <option value="grant">Grant role</option>
              <option value="revoke">Revoke role</option>
            </select>
          </label>
          {(op === "forceTransfer" || op === "forceBurn") && (
            <>
              <HolderSelect id="tl-from" label="From" value={from} onChange={setFrom} />
              {op === "forceTransfer" && <HolderSelect id="tl-to" label="To" value={to} onChange={setTo} exclude={from} />}
              <AmountField id="tl-amount" label="MMF" value={amount} onChange={setAmount} />
            </>
          )}
          {(op === "grant" || op === "revoke") && (
            <>
              <label className="field" htmlFor="tl-role">
                Role
                <select id="tl-role" value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
                  {ROLE_KEYS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" htmlFor="tl-grantee">
                {op === "grant" ? "To" : "From"}
                <select id="tl-grantee" value={grantee} onChange={(e) => setGrantee(e.target.value as PersonaKey)}>
                  {PERSONA_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {PERSONA_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <Action
            label="Propose"
            title="Create proposal"
            need="admin"
            variant="solid"
            build={async (as) => {
              const pr = proposal();
              return [await ix.createProposal(p, key(as), BigInt(Date.now()), pr.op, pr.data)];
            }}
          />
        </div>
      </div>

      <div className="board">
        {columns.map((col) => (
          <div className="col" key={col.title}>
            <h4>
              {col.title}
              <span>{col.items.length}</span>
            </h4>
            {col.items.length === 0 && <div className="empty">Nothing here.</div>}
            {col.items.map((prop) => {
              const lines = describe(decode(prop));
              const id = prop.address.toBase58();
              return (
                <div className="prop" key={id}>
                  <span className="t">{OP_LABEL[prop.op]}</span>
                  {lines.map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                  <span className="m">
                    by {label(prop.proposer)}
                    {prop.responder ? `, approved by ${label(prop.responder)}` : ""}
                    {prop.executer ? `, executed by ${label(prop.executer)}` : ""}
                  </span>
                  <div className="acts">
                    {prop.status === "proposed" && (
                      <Action
                        label="Approve"
                        title={`Approve: ${OP_LABEL[prop.op]}`}
                        need="responder"
                        build={async (as) => [await ix.respondProposal(p, key(as), prop.address)]}
                      />
                    )}
                    {prop.status === "accepted" && now < (prop.readyAt ?? 0) && (
                      <>
                        <span className="pill warn">ready in {fmtDuration((prop.readyAt ?? 0) - now)}</span>
                        <button
                          className="btn"
                          disabled={!!busy}
                          onClick={() => fastForward((prop.readyAt ?? 0) + 1, `Fast-forward to ${OP_LABEL[prop.op].toLowerCase()} delay end`)}
                        >
                          Fast-forward clock
                        </button>
                        <Action
                          label="Execute now"
                          title={`Execute early: ${OP_LABEL[prop.op]}`}
                          need="admin"
                          variant="danger"
                          tryable={false}
                          build={(as) => Promise.all(executeIxs(prop, as, false))}
                        />
                      </>
                    )}
                    {prop.status === "accepted" && now >= (prop.readyAt ?? 0) && (
                      <>
                        <Action
                          label="Execute"
                          title={`Execute: ${OP_LABEL[prop.op]}`}
                          need="admin"
                          variant="solid"
                          build={(as) => Promise.all(executeIxs(prop, as, false))}
                        />
                        <Action
                          label={`Execute ${editLabel(prop)}`}
                          title={`Execute with edits (${editLabel(prop)})`}
                          need="admin"
                          variant="danger"
                          tryable={false}
                          build={(as) => Promise.all(executeIxs(prop, as, true))}
                        />
                      </>
                    )}
                    {prop.status === "executed" && <span className="pill ok">executed</span>}
                    {prop.status === "cancelled" && <span className="pill none">cancelled</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="note accent">
        Fast-forward uses Surfpool's <code>surfnet_timeTravel</code> cheatcode to move the localnet clock. The program only reads{" "}
        <code>Clock::unix_timestamp</code>, so on a real cluster the only way past the delay is to wait.
      </div>
    </div>
  );
}
