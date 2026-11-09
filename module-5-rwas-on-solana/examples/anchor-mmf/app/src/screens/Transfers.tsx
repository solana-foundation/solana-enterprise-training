import { useState } from "react";
import { HOLDER_LABEL, HolderKey } from "../lib/constants";
import { fmtAmount, fmtDuration, fmtWindow, parseAmount } from "../lib/format";
import * as ix from "../lib/instructions";
import { usedThisWindow } from "../lib/state";
import { Action, AmountField, HolderPicker, HolderSelect, LastResult, ScreenHead } from "../components/ui";
import { useChainNow, useStore } from "../store";

const pct = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Math.min(100, Number((part * 10000n) / whole) / 100));

export function Transfers() {
  const { fund, env, key } = useStore();
  const now = useChainNow();
  const [from, setFrom] = useState<HolderKey>("holderA");
  const [to, setTo] = useState<HolderKey>("holderB");
  const [amount, setAmount] = useState("60");
  if (!fund) return null;
  const sender = fund.holders[from];
  const rc = fund.rateConfig;
  const cap = rc?.maxAmount ?? 0n;
  const used = usedThisWindow(sender, fund, now);
  const parsed = parseAmount(amount) ?? 0n;
  const room = cap > used ? cap - used : 0n;
  const fits = parsed <= room ? parsed : room;
  const over = parsed > room ? parsed - room : 0n;
  const resetIn = sender.rateLimit && rc && used > 0n ? sender.rateLimit.windowStart + rc.window - now : null;
  const dest = to === from ? (from === "holderB" ? "holderA" : "holderB") : to;
  // Scale the bar so an over-cap attempt still fits on screen.
  const scale = used + parsed > cap ? used + parsed : cap;

  return (
    <div className="screen">
      <ScreenHead title="Transfers">
        Token-2022 calls the transfer hook on every transfer of this mint. The hook adds up what each owner sends inside a
        rolling window and rejects anything that would pass the cap.
      </ScreenHead>
      <LastResult />

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <HolderPicker label="Sender" value={from} onChange={setFrom} />
          <span className="small mono">balance {fmtAmount(sender.amount)} MMF</span>
        </div>

        <div className="stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              Sent this window: <b className="mono">{fmtAmount(used)}</b> of <span className="mono">{fmtAmount(cap)}</span> MMF
            </span>
            <span className="small muted">
              {!sender.rateLimit
                ? "no rate-limit account yet: run that onboarding step"
                : resetIn !== null && resetIn > 0
                  ? `window resets in ${fmtDuration(resetIn)}`
                  : `window: ${rc ? fmtWindow(rc.window) : "-"}`}
            </span>
          </div>
          <div className="meter" role="img" aria-label={`${fmtAmount(used)} of ${fmtAmount(cap)} used, this transfer adds ${fmtAmount(parsed)}`}>
            <span className="used" style={{ width: `${pct(used, scale)}%` }} />
            <span className="try" style={{ width: `${pct(fits, scale)}%` }} />
            <span className="over" style={{ width: `${pct(over, scale)}%` }} />
          </div>
          <span className="small muted">
            {over > 0n
              ? `This transfer goes ${fmtAmount(over)} MMF over the cap: the hook will reject it.`
              : "Blue: already sent. Green: this transfer. Striped red would mean over the cap."}
          </span>
        </div>

        <div className="row" style={{ alignItems: "end" }}>
          <HolderSelect id="tx-to" label="To" value={dest} onChange={setTo} exclude={from} />
          <AmountField id="tx-amount" label="MMF" value={amount} onChange={setAmount} />
          <button className="btn ghost" onClick={() => setAmount(fmtAmount(room > 0n ? room : 1n).replace(/,/g, ""))}>
            Fill to the cap
          </button>
          <button className="btn ghost" onClick={() => setAmount(fmtAmount(room + 50_0000n).replace(/,/g, ""))}>
            Fill over the cap
          </button>
          <Action
            label="Send"
            title={`Send ${fmtAmount(parsed)} MMF from ${HOLDER_LABEL[from]} to ${HOLDER_LABEL[dest]}`}
            need={from}
            variant="solid"
            disabled={parsed === 0n}
            tryable={false}
            build={(as) => [ix.transferChecked(env.mint, key(as), key(dest), parsed)]}
          />
        </div>
      </div>

      <div className="grid2">
        <div className="note accent">
          Open a transfer in the inspector: the call tree shows Token-2022 calling <b>mmf_transfer_hook</b> as a CPI. The four
          extra accounts at the end of the instruction come from the hook's extra-account-meta list.
        </div>
        <div className="note">
          A force transfer from the Timelock screen is not throttled, even above the cap. The hook sees the permanent delegate
          (the Config PDA) as the authority and skips the limit, so a seizure is never blocked.
        </div>
      </div>
    </div>
  );
}
