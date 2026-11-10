import { useState } from "react";
import { HOLDER_LABEL, HolderKey } from "../lib/constants";
import { fmtAmount, fmtWindow, parseAmount } from "../lib/format";
import * as ix from "../lib/instructions";
import { AccountPill, Action, AmountField, HolderPicker, LastResult, ListPill, Pill, ScreenHead } from "../components/ui";
import { useStore } from "../store";

const SIDELINE_OPTIONS = ["holderA", "holderB", "outsider"] as const satisfies readonly HolderKey[];

export function Controls() {
  const { fund, env, programs: p, key } = useStore();
  const [target, setTarget] = useState<HolderKey>("holderB");
  const [burn, setBurn] = useState("50");
  const [cap, setCap] = useState("");
  const [windowSecs, setWindowSecs] = useState("");
  if (!fund) return null;
  const { mint, listConfig } = env;
  const paused = !!fund.mint?.paused;
  const h = fund.holders[target];
  const who = HOLDER_LABEL[target];
  const treasury = fund.holders.admin;
  const burnAmount = parseAmount(burn);
  const rc = fund.rateConfig;
  const capValue = cap === "" ? rc?.maxAmount ?? null : parseAmount(cap);
  const windowValue = windowSecs === "" ? rc?.window ?? null : Number.parseInt(windowSecs, 10);

  return (
    <div className="screen">
      <ScreenHead title="Compliance and controls">
        Pause and the burner's self-burn take effect immediately. Freezing is a Token ACL call made by the client. Force actions,
        on the Timelock screen, are the only controls that wait.
      </ScreenHead>
      <LastResult />

      <div className="grid2">
        <div className="card">
          <div className="card-head">
            <h3>Pause the fund</h3>
            {paused ? <Pill tone="bad">paused</Pill> : <Pill tone="ok">live</Pill>}
            <p>
              Drives the mint's Token-2022 Pausable extension. Every transfer, mint and burn stops at the token-program level,
              so the hook never even runs. Needs PAUSER, no timelock: a circuit breaker has to act in the same block.
            </p>
          </div>
          <div className="row">
            <Action
              label={paused ? "Resume fund" : "Pause fund"}
              need="admin"
              variant={paused ? "solid" : "danger"}
              build={async (as) => [await ix.setPaused(p, key(as), mint, !paused)]}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Burn redeemed shares</h3>
            <span className="small mono">treasury {fmtAmount(treasury.amount)} MMF</span>
            <p>
              <code>permissioned_burn</code>: the BURNER burns from its own token account and the Config PDA co-signs. A plain
              Token-2022 BurnChecked is refused, because PermissionedBurn disables it on this mint.
            </p>
          </div>
          <div className="row" style={{ alignItems: "end" }}>
            <AmountField id="burn-amount" label="MMF" value={burn} onChange={setBurn} />
            <Action
              label="Burn"
              title={`Permissioned burn of ${burn} MMF`}
              need="admin"
              variant="solid"
              disabled={!burnAmount}
              build={async (as) => [await ix.permissionedBurn(p, key(as), mint, burnAmount!)]}
            />
            <Action
              label="Plain BurnChecked"
              title={`Plain Token-2022 BurnChecked of ${burn} MMF`}
              need="admin"
              variant="danger"
              tryable={false}
              disabled={!burnAmount}
              build={(as) => [ix.burnChecked(key(as), mint, burnAmount!)]}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Sideline a holder</h3>
          <p>
            Freezing stops an account at once, but while the owner is still on the allow list they can thaw it again
            themselves. To make it stick, also remove them from the list. Try it in that order.
          </p>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <HolderPicker label="Holder" value={target} onChange={setTarget} options={SIDELINE_OPTIONS} />
          <span className="row small">
            <ListPill h={h} />
            <AccountPill h={h} />
          </span>
        </div>
        <div className="row">
          <Action
            label="Freeze"
            title={`Freeze ${who} (Token ACL)`}
            need="admin"
            variant="danger"
            disabled={!h.ataExists}
            build={(as) => [ix.aclFreeze(key(as), mint, key(target))]}
          />
          <Action
            label="Self-thaw"
            title={`${who} thaws their own account`}
            need={target}
            tryable={false}
            disabled={!h.ataExists}
            build={(as) => [ix.aclThawPermissionless(key(as), mint, key(target), listConfig)]}
          />
          {h.allowlisted ? (
            <Action
              label="Remove from allow list"
              title={`Remove ${who} from the allow list`}
              need="admin"
              variant="danger"
              build={(as) => [ix.gateRemoveWallet(key(as), listConfig, key(target))]}
            />
          ) : (
            <Action
              label="Add back to allow list"
              title={`Add ${who} back to the allow list`}
              need="admin"
              build={(as) => [ix.gateAddWallet(key(as), listConfig, key(target))]}
            />
          )}
          <Action
            label="Authority thaw"
            title={`Authority thaw of ${who} (Token ACL)`}
            need="admin"
            disabled={!h.ataExists}
            build={(as) => [ix.aclThaw(key(as), mint, key(target))]}
          />
        </div>
        <div className="note">
          None of these touch mmf_admin. The mint's freeze authority belongs to the Token ACL MintConfig, and the Admin is its
          recorded authority.
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Rate limit</h3>
          <span className="small mono">
            now {rc ? `${fmtAmount(rc.maxAmount)} MMF per ${fmtWindow(rc.window)}` : "-"}
          </span>
          <p>One config per mint, read by the hook on every transfer. Every holder gets the new cap on their next transfer.</p>
        </div>
        <div className="row" style={{ alignItems: "end" }}>
          <AmountField id="rl-cap" label="Cap (MMF)" value={cap === "" && rc ? fmtAmount(rc.maxAmount).replace(/,/g, "") : cap} onChange={setCap} />
          <label className="field" htmlFor="rl-window">
            Window (seconds)
            <input
              id="rl-window"
              inputMode="numeric"
              value={windowSecs === "" && rc ? String(rc.window) : windowSecs}
              onChange={(e) => setWindowSecs(e.target.value)}
            />
          </label>
          <Action
            label="Update limit"
            need="admin"
            disabled={!capValue || !windowValue || windowValue <= 0}
            build={async (as) => [await ix.setRateLimit(p, key(as), mint, capValue!, windowValue!)]}
          />
        </div>
      </div>
    </div>
  );
}
