import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PERSONA_KEYS, PERSONA_LABEL } from "./lib/constants";
import { parseEnv, registerNames, type Env, type LocalnetFile } from "./lib/env";
import { fmtChainTime } from "./lib/format";
import { Inspector } from "./components/Inspector";
import { PersonaDot } from "./components/ui";
import { Controls } from "./screens/Controls";
import { Dashboard } from "./screens/Dashboard";
import { Onboarding } from "./screens/Onboarding";
import { Timelock } from "./screens/Timelock";
import { Transfers } from "./screens/Transfers";
import { StoreProvider, useChainNow, useStore } from "./store";

const SCREENS = [
  { id: "dashboard", label: "Dashboard", el: <Dashboard /> },
  { id: "onboarding", label: "Onboarding", el: <Onboarding /> },
  { id: "timelock", label: "Timelock", el: <Timelock /> },
  { id: "transfers", label: "Transfers", el: <Transfers /> },
  { id: "controls", label: "Controls", el: <Controls /> },
] as const;

function useHashRoute(): string {
  const read = () => location.hash.replace("#", "") || "dashboard";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

function Setup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="setup">
      <h2>{title}</h2>
      {children}
      <pre>{`cd module-5-rwas-on-solana/examples/anchor-mmf
anchor build

cd app
yarn localnet          # terminal 1: offline Surfpool with all 5 programs
yarn bootstrap         # terminal 2: create the fund and the personas
yarn dev`}</pre>
    </div>
  );
}

function TopBar() {
  const { active, setActive, fund, busy, env } = useStore();
  const now = useChainNow();
  return (
    <header className="topbar">
      <span className="brand">
        MMF Console<small>anchor-mmf</small>
      </span>
      <span className="chip" title={env.rpcUrl}>
        localnet · surfpool
      </span>
      <span className="chip" title="Clock::unix_timestamp on the localnet">
        chain time {fmtChainTime(now)}
      </span>
      {fund?.mint?.paused && <span className="chip paused">fund paused</span>}
      {busy && <span className="chip">sending: {busy}</span>}
      <span className="spacer" />
      <div className="personas" role="group" aria-label="Sign as">
        {PERSONA_KEYS.map((k) => (
          <button key={k} className="persona-btn" aria-pressed={active === k} onClick={() => setActive(k)}>
            <PersonaDot k={k} />
            {PERSONA_LABEL[k]}
          </button>
        ))}
      </div>
    </header>
  );
}

function Shell() {
  const { fund, loadError } = useStore();
  const route = useHashRoute();
  const screen = SCREENS.find((s) => s.id === route) ?? SCREENS[0];

  if (!fund && loadError) {
    return (
      <Setup title="Can't reach the localnet">
        <p className="muted">{loadError}</p>
        <p>Start the localnet, bootstrap a fund, then reload this page.</p>
      </Setup>
    );
  }
  if (fund && !fund.initialized) {
    return (
      <Setup title="This localnet has no fund">
        <p>
          <code>public/localnet.json</code> points at a fund that isn't on the running localnet, usually because the localnet was
          restarted. Run <code>yarn bootstrap</code> again and reload.
        </p>
      </Setup>
    );
  }

  return (
    <>
      <TopBar />
      <nav className="tabs" aria-label="Screens">
        {SCREENS.map((s, i) => (
          <a key={s.id} className="tab" href={`#${s.id}`} aria-current={s.id === screen.id ? "page" : undefined}>
            <span className="n">{i + 1}</span>
            {s.label}
          </a>
        ))}
      </nav>
      <main className="main">
        {fund ? screen.el : <p className="muted">Loading the fund…</p>}
        <Inspector />
      </main>
    </>
  );
}

export function App() {
  const [file, setFile] = useState<LocalnetFile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/localnet.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: LocalnetFile) => (j.personas ? setFile(j) : setMissing(true)))
      .catch(() => setMissing(true));
  }, []);

  const env: Env | null = useMemo(() => {
    if (!file) return null;
    const e = parseEnv(file);
    registerNames(e);
    return e;
  }, [file]);

  if (missing) {
    return (
      <Setup title="No fund yet">
        <p>
          The console reads <code>public/localnet.json</code>, which <code>yarn bootstrap</code> writes. Run these, then reload:
        </p>
      </Setup>
    );
  }
  if (!env) return null;
  return (
    <StoreProvider env={env}>
      <Shell />
    </StoreProvider>
  );
}
