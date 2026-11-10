import { GATE_ID, HOLDER_KEYS, HOLDER_LABEL, HOOK_ID, MMF_ADMIN_ID, TOKEN_2022_ID, TOKEN_ACL_ID } from "../lib/constants";
import { fmtAmount, fmtWindow } from "../lib/format";
import { label, pdas, short } from "../lib/names";
import { usedThisWindow } from "../lib/state";
import { AccountPill, ListPill, PersonaDot, Pill, ScreenHead } from "../components/ui";
import { useChainNow, useStore } from "../store";

const PROGRAMS = [
  { id: MMF_ADMIN_ID, name: "mmf_admin", role: "issuer: roles, timelock, mint/burn, force actions", ext: false },
  { id: HOOK_ID, name: "mmf_transfer_hook", role: "rate limit on every transfer", ext: false },
  { id: TOKEN_ACL_ID, name: "Token ACL", role: "holds freeze authority, permissionless thaw", ext: true },
  { id: GATE_ID, name: "ABL gate", role: "the allow list behind the thaw", ext: true },
  { id: TOKEN_2022_ID, name: "Token-2022", role: "the token program itself", ext: false },
];

export function Dashboard() {
  const { fund, env } = useStore();
  const now = useChainNow();
  if (!fund) return null;
  const onboarded = HOLDER_KEYS.filter((k) => fund.holders[k].ataExists && !fund.holders[k].frozen).length;
  const rc = fund.rateConfig;

  return (
    <div className="screen">
      <ScreenHead title="Fund dashboard">
        Everything here is read from accounts: the Config PDA, Role PDAs, the mint's extensions and each holder's token
        account. Nothing lives in a server.
      </ScreenHead>

      <div className="tiles">
        <div className="tile">
          <span className="k">Supply</span>
          <span className="v">{fmtAmount(fund.mint?.supply ?? 0n)}</span>
        </div>
        <div className="tile">
          <span className="k">Mint state</span>
          <span className="v">{fund.mint?.paused ? <Pill tone="bad">paused</Pill> : <Pill tone="ok">live</Pill>}</span>
        </div>
        <div className="tile">
          <span className="k">Rate cap</span>
          <span className="v">{rc ? `${fmtAmount(rc.maxAmount).replace(/\.0+$/, "")} / ${fmtWindow(rc.window)}` : "-"}</span>
        </div>
        <div className="tile">
          <span className="k">Live holders</span>
          <span className="v">
            {onboarded} of {HOLDER_KEYS.length}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Holders</h3>
          <p>A token account starts frozen. It can move MMF only after its owner is on the allow list and the account is thawed.</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Holder</th>
                <th>Allow list</th>
                <th>Token account</th>
                <th className="r">Balance (MMF)</th>
                <th className="r">Sent this window</th>
              </tr>
            </thead>
            <tbody>
              {HOLDER_KEYS.map((k) => {
                const h = fund.holders[k];
                return (
                  <tr key={k}>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <PersonaDot k={k} small />
                        {HOLDER_LABEL[k]}
                      </span>
                    </td>
                    <td>
                      <ListPill h={h} />
                    </td>
                    <td>
                      <AccountPill h={h} />
                    </td>
                    <td className="r mono">{fmtAmount(h.amount)}</td>
                    <td className="r mono">{h.rateLimit ? fmtAmount(usedThisWindow(h, fund, now)) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-head">
            <h3>Roles</h3>
            <p>One PDA per (role, holder): seeds ["mmf-role", role, grantee]. Granting or revoking goes through the timelock.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Granted to</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {fund.roles
                  .slice()
                  .sort((a, b) => (a.role ?? "").localeCompare(b.role ?? ""))
                  .map((r) => (
                    <tr key={r.address.toBase58()}>
                      <td className="mono">{r.role ?? "unknown"}</td>
                      <td>{label(r.grantee)}</td>
                      <td>{r.granted ? <Pill tone="ok">granted</Pill> : <Pill tone="none">revoked</Pill>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Programs</h3>
            <p>The console talks to all five. The blue ones are the external sRFC-37 standard.</p>
          </div>
          <div className="table-wrap">
            <table>
              <tbody>
                {PROGRAMS.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <Pill tone={p.ext ? "ext" : "info"}>{p.name}</Pill>
                    </td>
                    <td className="small muted">{p.role}</td>
                    <td className="mono small">{short(p.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Fund accounts</h3>
        </div>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <td>Config PDA</td>
                <td className="small muted">admin {fund.config ? label(fund.config.admin) : "-"}, version {fund.config?.version.toString()}</td>
                <td className="mono small">{short(pdas.config())}</td>
              </tr>
              <tr>
                <td>MMF mint</td>
                <td className="small muted">Token-2022, 4 decimals, default-frozen, pausable, hook, permanent delegate, permissioned burn</td>
                <td className="mono small">{short(env.mint)}</td>
              </tr>
              <tr>
                <td>Token ACL MintConfig</td>
                <td className="small muted">holds the mint's freeze authority</td>
                <td className="mono small">{short(pdas.mintConfig(env.mint))}</td>
              </tr>
              <tr>
                <td>Allow list</td>
                <td className="small muted">ABL gate list in Allow mode, owned by Admin</td>
                <td className="mono small">{short(env.listConfig)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
