import { Keypair, PublicKey } from "@solana/web3.js";
import { MMF_ADMIN_ID, PERSONA_KEYS, PERSONA_LABEL, PersonaKey, ROLE_KEYS } from "./constants";
import { pdas, setName } from "./names";

/**
 * What `yarn bootstrap` writes to `public/localnet.json`. It holds burner
 * secret keys, so it is localnet-only and gitignored.
 */
export interface LocalnetFile {
  rpcUrl: string;
  mint: string;
  listConfig: string;
  personas: Record<PersonaKey, number[]>;
  createdAt: string;
}

export interface Env {
  rpcUrl: string;
  mint: PublicKey;
  listConfig: PublicKey;
  personas: Record<PersonaKey, Keypair>;
}

export function parseEnv(file: LocalnetFile): Env {
  const personas = Object.fromEntries(
    PERSONA_KEYS.map((k) => [k, Keypair.fromSecretKey(Uint8Array.from(file.personas[k]))]),
  ) as Record<PersonaKey, Keypair>;
  return {
    rpcUrl: file.rpcUrl,
    mint: new PublicKey(file.mint),
    listConfig: new PublicKey(file.listConfig),
    personas,
  };
}

/** Gives the inspector readable names for every address the fund uses. */
export function registerNames(env: Env) {
  setName(env.mint, "MMF mint");
  setName(env.listConfig, "Allow list (list_config)");
  setName(pdas.config(), "Config PDA");
  setName(pdas.mintConfig(env.mint), "Token ACL MintConfig");
  setName(pdas.extraMetas(env.mint), "Hook extra-account-meta list");
  setName(pdas.rateConfig(env.mint), "Rate-limit config");
  setName(pdas.thawExtraMetas(env.mint), "Gate thaw extra metas");
  setName(pdas.eventAuthority(), "mmf_admin event authority");
  setName(MMF_ADMIN_ID, "mmf_admin");
  for (const k of PERSONA_KEYS) {
    const wallet = env.personas[k].publicKey;
    const who = PERSONA_LABEL[k];
    setName(wallet, who);
    setName(pdas.ata(wallet, env.mint), k === "admin" ? "Treasury token account" : `${who} token account`);
    setName(pdas.rateLimit(env.mint, wallet), `${who} rate limit`);
    setName(pdas.walletEntry(env.listConfig, wallet), `${who} allow-list entry`);
    setName(pdas.flag(pdas.ata(wallet, env.mint)), `${who} thaw flag`);
    for (const r of ROLE_KEYS) setName(pdas.role(r, wallet), `${r} role of ${who}`);
  }
  setName(pdas.rateLimit(env.mint, pdas.config()), "Rate limit for Config PDA (never created)");
}
