import type { ReactNode } from "react";
import { HOLDER_KEYS, HOLDER_LABEL, HolderKey, PERSONA_INITIALS, PERSONA_LABEL, PersonaKey } from "../lib/constants";
import type { Ix } from "../lib/instructions";
import type { HolderState } from "../lib/state";
import { useStore } from "../store";

export function PersonaDot({ k, small }: { k: PersonaKey; small?: boolean }) {
  return (
    <span className={`dot p-${k}${small ? " sm" : ""}`} aria-hidden="true">
      {small ? "" : PERSONA_INITIALS[k]}
    </span>
  );
}

export function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "info" | "ext" | "none"; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function AccountPill({ h }: { h: HolderState }) {
  if (!h.ataExists) return <Pill tone="none">no account</Pill>;
  return h.frozen ? <Pill tone="bad">frozen</Pill> : <Pill tone="ok">thawed</Pill>;
}

export function ListPill({ h }: { h: HolderState }) {
  return h.allowlisted ? <Pill tone="ext">allowlisted</Pill> : <Pill tone="none">not listed</Pill>;
}

/**
 * A button that signs as a specific persona. The main button switches to
 * that persona and runs. When another persona is active, a second button
 * runs the same thing as the active persona, so the class can watch the
 * program reject it.
 */
export function Action({
  label,
  title,
  need,
  build,
  variant = "plain",
  tryable = true,
  disabled,
}: {
  label: string;
  title?: string;
  need: PersonaKey;
  build: (as: PersonaKey) => Promise<Ix[]> | Ix[];
  variant?: "plain" | "solid" | "danger";
  tryable?: boolean;
  disabled?: boolean;
}) {
  const { active, setActive, run, busy } = useStore();
  const name = title ?? label;
  const cls = variant === "plain" ? "btn" : `btn ${variant}`;
  return (
    <span className="action">
      <button
        className={cls}
        disabled={!!busy || disabled}
        onClick={() => {
          setActive(need);
          run(name, need, () => build(need));
        }}
      >
        {label}
        <span className="as">as {PERSONA_LABEL[need]}</span>
      </button>
      {tryable && active !== need && (
        <button
          className="btn ghost"
          disabled={!!busy}
          title={`Sign with ${PERSONA_LABEL[active]} instead, to see what the program does`}
          onClick={() => run(`${name} (as ${PERSONA_LABEL[active]})`, active, () => build(active))}
        >
          Try as {PERSONA_LABEL[active]}
        </button>
      )}
    </span>
  );
}

export function HolderPicker({
  value,
  onChange,
  options = HOLDER_KEYS,
  label,
}: {
  value: HolderKey;
  onChange: (k: HolderKey) => void;
  options?: readonly HolderKey[];
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((k) => (
        <button key={k} aria-pressed={value === k} onClick={() => onChange(k)}>
          <PersonaDot k={k} small />
          {HOLDER_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

export function HolderSelect({
  id,
  label,
  value,
  onChange,
  exclude,
}: {
  id: string;
  label: string;
  value: HolderKey;
  onChange: (k: HolderKey) => void;
  exclude?: HolderKey;
}) {
  return (
    <label className="field" htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as HolderKey)}>
        {HOLDER_KEYS.filter((k) => k !== exclude).map((k) => (
          <option key={k} value={k}>
            {HOLDER_LABEL[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AmountField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field" htmlFor={id}>
      {label}
      <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** The latest result from this screen, shown under its heading. */
export function LastResult() {
  const { selected, txs, select } = useStore();
  const here = location.hash.replace("#", "") || "dashboard";
  const rec = txs[0]?.screen === here ? txs[0] : null;
  if (!rec) return null;
  const tone = rec.kind === "cheat" ? "cheat" : rec.ok ? "ok" : "bad";
  return (
    <div className={`result ${tone}`} role="status">
      <div className="t">
        <span className="name">{rec.ok ? (rec.kind === "cheat" ? "Clock moved" : "Confirmed") : rec.error?.name ?? "Failed"}</span>
        <span>{rec.title}</span>
        {selected?.id !== rec.id && (
          <button className="link" onClick={() => select(rec.id)}>
            Show in inspector
          </button>
        )}
      </div>
      {rec.kind === "cheat" && <span className="small">{rec.note}</span>}
      {!rec.ok && rec.error && <span className="small">{rec.error.hint ?? rec.error.message}</span>}
    </div>
  );
}

export function ScreenHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="screen-head">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
