import { PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";

// ---- program ids -----------------------------------------------------------
// Must match `declare_id!` in both programs and `Anchor.toml`.

export const MMF_ADMIN_ID = new PublicKey("3Aenr8ahixrmMdGhivPQWwo4dZQqFSucSiW2ivUFb27e");
export const HOOK_ID = new PublicKey("FPX37yHKMHXsJyYUgsjSrXts5ndGsS6pADM2Eok13LeX");
// External sRFC-37 programs (vendored as .so fixtures for localnet).
export const TOKEN_ACL_ID = new PublicKey("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
export const GATE_ID = new PublicKey("GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz");

export const TOKEN_2022_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
export const RENT_SYSVAR_ID = SYSVAR_RENT_PUBKEY;
export const CLOCK_SYSVAR_ID = SYSVAR_CLOCK_PUBKEY;

export const PROGRAM_NAMES: Record<string, string> = {
  [MMF_ADMIN_ID.toBase58()]: "mmf_admin",
  [HOOK_ID.toBase58()]: "mmf_transfer_hook",
  [TOKEN_ACL_ID.toBase58()]: "Token ACL",
  [GATE_ID.toBase58()]: "ABL gate",
  [TOKEN_2022_ID.toBase58()]: "Token-2022",
  [ATA_PROGRAM_ID.toBase58()]: "Associated Token",
  [SYSTEM_PROGRAM_ID.toBase58()]: "System",
  ["ComputeBudget111111111111111111111111111111"]: "Compute Budget",
};

// ---- token -----------------------------------------------------------------

export const DECIMALS = 4;

// ---- roles -----------------------------------------------------------------
// 32-byte identifiers, identical to `programs/anchor-mmf/src/state/role.rs`.

export const ROLE_KEYS = ["MINTER", "BURNER", "PAUSER", "COMPLIANCE_DELEGATE", "RESPONDER"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const ROLE_STRINGS: Record<RoleKey, string> = {
  MINTER: "MMF__MINTER_ROLE________________",
  BURNER: "MMF__BURNER_ROLE________________",
  PAUSER: "MMF__PAUSER_ROLE________________",
  COMPLIANCE_DELEGATE: "MMF__COMPLIANCE_DELEGATE_ROLE___",
  RESPONDER: "MMF__RESPONDER_ROLE_____________",
};

export const ROLE_IDS = Object.fromEntries(
  ROLE_KEYS.map((k) => {
    const bytes = new TextEncoder().encode(ROLE_STRINGS[k]);
    if (bytes.length !== 32) throw new Error(`role ${k} is ${bytes.length} bytes, expected 32`);
    return [k, bytes];
  }),
) as Record<RoleKey, Uint8Array>;

export function roleKeyFromBytes(bytes: ArrayLike<number>): RoleKey | undefined {
  return ROLE_KEYS.find((k) => ROLE_IDS[k].every((b, i) => b === bytes[i]));
}

// ---- timelock --------------------------------------------------------------
// Mirrors `TimeLockOperation` (borsh variant order) and the delays in
// `programs/anchor-mmf/src/constants.rs`.

export type TimeLockOp = "setRole" | "transfer" | "burn" | "forceBurn" | "forceTransfer" | "ownershipTransfer";

export const TIMELOCK_DELAY: Record<TimeLockOp, number> = {
  setRole: 2 * 24 * 60 * 60,
  transfer: 24 * 60 * 60,
  burn: 24 * 60 * 60,
  forceBurn: 24 * 60 * 60,
  forceTransfer: 24 * 60 * 60,
  ownershipTransfer: 7 * 24 * 60 * 60,
};

export const OP_LABEL: Record<TimeLockOp, string> = {
  setRole: "Set role",
  transfer: "Transfer",
  burn: "Redemption burn",
  forceBurn: "Force burn",
  forceTransfer: "Force transfer",
  ownershipTransfer: "Ownership transfer",
};

// ---- personas --------------------------------------------------------------

export const PERSONA_KEYS = ["admin", "responder", "holderA", "holderB", "outsider"] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export const PERSONA_LABEL: Record<PersonaKey, string> = {
  admin: "Admin",
  responder: "Responder",
  holderA: "Holder A",
  holderB: "Holder B",
  outsider: "Outsider",
};

export const PERSONA_INITIALS: Record<PersonaKey, string> = {
  admin: "AD",
  responder: "RS",
  holderA: "HA",
  holderB: "HB",
  outsider: "OU",
};

// Personas that can hold MMF. The admin's own token account is the issuer
// treasury: seized shares land there and `permissioned_burn` burns from it.
export const HOLDER_KEYS = ["holderA", "holderB", "outsider", "admin"] as const satisfies readonly PersonaKey[];
export type HolderKey = (typeof HOLDER_KEYS)[number];

export const HOLDER_LABEL: Record<HolderKey, string> = {
  holderA: "Holder A",
  holderB: "Holder B",
  outsider: "Outsider",
  admin: "Treasury (Admin)",
};
