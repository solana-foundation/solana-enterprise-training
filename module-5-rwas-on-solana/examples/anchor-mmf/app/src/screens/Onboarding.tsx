import { useState } from "react";
import { HOLDER_LABEL, HolderKey } from "../lib/constants";
import { fmtAmount, parseAmount } from "../lib/format";
import * as ix from "../lib/instructions";
import { Action, AmountField, HolderPicker, LastResult, ListPill, AccountPill, ScreenHead } from "../components/ui";
import { useStore } from "../store";

export function Onboarding() {
  const { fund, env, programs: p, key } = useStore();
  const [holder, setHolder] = useState<HolderKey>("holderA");
  const [amount, setAmount] = useState("200");
  if (!fund) return null;
  const h = fund.holders[holder];
  const who = HOLDER_LABEL[holder];
  const { mint, listConfig } = env;
  const parsed = parseAmount(amount);

  const steps = [
    {
      title: "Add to the allow list",
      what: "The list authority records the wallet in the ABL gate's Allow-mode list.",
      code: "ABL gate · add_wallet",
      done: h.allowlisted,
      action: (
        <Action
          label="Add"
          title={`Add ${who} to the allow list`}
          need="admin"
          build={(as) => [ix.gateAddWallet(key(as), listConfig, key(holder))]}
        />
      ),
    },
    {
      title: "Create the token account",
      what: "Anyone can create it. DefaultAccountState makes it start frozen.",
      code: "Associated Token · create_idempotent",
      done: h.ataExists,
      action: (
        <Action
          label="Create"
          title={`Create ${who}'s token account`}
          need={holder}
          tryable={false}
          build={(as) => [ix.createAta(key(as), key(holder), mint)]}
        />
      ),
    },
    {
      title: "Thaw it",
      what: "Permissionless: anyone may call it, and Token ACL asks the gate whether the owner is on the list.",
      code: "Token ACL · thaw_permissionless → ABL gate",
      done: h.ataExists && !h.frozen,
      action: (
        <Action
          label="Thaw"
          title={`Thaw ${who}'s token account`}
          need={holder}
          tryable={false}
          build={(as) => [ix.aclThawPermissionless(key(as), mint, key(holder), listConfig)]}
        />
      ),
    },
    {
      title: "Create the rate-limit account",
      what: "The hook meters outbound transfers per owner, and it cannot create accounts mid-transfer.",
      code: "mmf_transfer_hook · initialize_rate_limit_ix",
      done: !!h.rateLimit,
      action: (
        <Action
          label="Create"
          title={`Create ${who}'s rate-limit account`}
          need={holder}
          tryable={false}
          build={async (as) => [await ix.initRateLimit(p, key(as), key(holder), mint)]}
        />
      ),
    },
    {
      title: "Mint shares",
      what: "Needs the MINTER role. Fails with AccountFrozen if any step above was skipped.",
      code: "mmf_admin · mint_mmf",
      done: h.amount > 0n,
      action: (
        <div className="row">
          <AmountField id="mint-amount" label="MMF" value={amount} onChange={setAmount} />
          <Action
            label="Mint"
            title={`Mint ${parsed !== null ? fmtAmount(parsed) : amount} MMF to ${who}`}
            need="admin"
            variant="solid"
            disabled={!parsed}
            build={async (as) => [await ix.mintMmf(p, key(as), mint, key(holder), parsed!)]}
          />
        </div>
      ),
    },
  ];
  const nowIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="screen">
      <ScreenHead title="Onboarding">
        Five steps take a holder from nothing to holding shares. Each button signs as the persona that step needs, and you can
        run the steps out of order to see which program objects.
      </ScreenHead>
      <LastResult />

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <HolderPicker label="Holder to onboard" value={holder} onChange={setHolder} />
          <span className="row small">
            <ListPill h={h} />
            <AccountPill h={h} />
            <span className="mono">{fmtAmount(h.amount)} MMF</span>
          </span>
        </div>
        <div className="steps">
          {steps.map((s, i) => (
            <div key={s.title} className={`step${s.done ? " done" : i === nowIndex ? " now" : ""}`}>
              <span className="mk" />
              <span className="lbl">
                <b>{s.title}</b>
                <small>{s.what}</small>
                <code>{s.code}</code>
              </span>
              <span className="step-side">{s.done && i !== steps.length - 1 ? <span className="pill ok">done</span> : s.action}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-head">
            <h3>Skip onboarding</h3>
            <p>
              The Outsider was never added to the allow list. Minting to them fails, because their token account stays
              frozen. Thawing it yourself fails too, because the gate refuses.
            </p>
          </div>
          <div className="row">
            <Action
              label="Mint 10 to Outsider"
              need="admin"
              variant="danger"
              tryable={false}
              build={async (as) => [await ix.mintMmf(p, key(as), mint, key("outsider"), 10_0000n)]}
            />
            <Action
              label="Outsider self-thaw"
              need="outsider"
              variant="danger"
              tryable={false}
              build={(as) => [ix.createAta(key(as), key(as), mint), ix.aclThawPermissionless(key(as), mint, key(as), listConfig)]}
            />
          </div>
        </div>
        <div className="note">
          Thawing never touches mmf_admin. Open a thaw in the inspector: the issuer program is absent. The allow list is a
          standard (sRFC-37) the issuer plugs into, and the issuer writes no code for it.
        </div>
      </div>
    </div>
  );
}
