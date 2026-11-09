import BN from "bn.js";
import { PublicKey, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import {
  ATA_PROGRAM_ID,
  DECIMALS,
  GATE_ID,
  HOOK_ID,
  MMF_ADMIN_ID,
  RENT_SYSVAR_ID,
  ROLE_IDS,
  RoleKey,
  SYSTEM_PROGRAM_ID,
  TimeLockOp,
  TOKEN_2022_ID,
  TOKEN_ACL_ID,
} from "./constants";
import { pdas } from "./names";
import { idlAccountNames, type Programs } from "./programs";

/** An instruction plus what the inspector needs to explain it. */
export interface Ix {
  ix: TransactionInstruction;
  program: string;
  name: string;
  /** One name per account key, in order. */
  accounts: string[];
}

type Builder = { instruction(): Promise<TransactionInstruction> };

async function anchorIx(program: "mmf_admin" | "mmf_transfer_hook", name: string, builder: Builder): Promise<Ix> {
  return { ix: await builder.instruction(), program, name, accounts: idlAccountNames(program, name) };
}

function rawIx(programId: PublicKey, program: string, name: string, metas: [string, AccountMeta][], data: number[] | Uint8Array): Ix {
  return {
    ix: new TransactionInstruction({ programId, keys: metas.map(([, m]) => m), data: Buffer.from(data) }),
    program,
    name,
    accounts: metas.map(([n]) => n),
  };
}

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });

function u64(n: bigint): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...b];
}

// ---------------------------------------------------------------------------
// mmf_admin (Anchor client from the IDL)
// ---------------------------------------------------------------------------

export function initialize(p: Programs, admin: PublicKey, mint: PublicKey, responder: PublicKey) {
  return anchorIx(
    "mmf_admin",
    "initialize",
    p.admin.methods.initialize().accountsStrict({
      admin,
      config: pdas.config(),
      mint,
      responder,
      adminMinterRole: pdas.role("MINTER", admin),
      adminBurnerRole: pdas.role("BURNER", admin),
      adminPauserRole: pdas.role("PAUSER", admin),
      adminComplianceRole: pdas.role("COMPLIANCE_DELEGATE", admin),
      responderRole: pdas.role("RESPONDER", responder),
      mmfTransferHookProgram: HOOK_ID,
      tokenProgram: TOKEN_2022_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: RENT_SYSVAR_ID,
    }),
  );
}

export function mintMmf(p: Programs, minter: PublicKey, mint: PublicKey, recipient: PublicKey, amount: bigint) {
  return anchorIx(
    "mmf_admin",
    "mint_mmf",
    p.admin.methods.mintMmf(new BN(amount.toString())).accountsStrict({
      minter,
      payer: minter,
      config: pdas.config(),
      role: pdas.role("MINTER", minter),
      mint,
      recipient,
      recipientAta: pdas.ata(recipient, mint),
      tokenProgram: TOKEN_2022_ID,
      associatedTokenProgram: ATA_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
    }),
  );
}

export function setPaused(p: Programs, pauser: PublicKey, mint: PublicKey, paused: boolean) {
  return anchorIx(
    "mmf_admin",
    "set_paused",
    p.admin.methods.setPaused(paused).accountsStrict({
      pauser,
      config: pdas.config(),
      role: pdas.role("PAUSER", pauser),
      mint,
      tokenProgram: TOKEN_2022_ID,
    }),
  );
}

export function permissionedBurn(p: Programs, burner: PublicKey, mint: PublicKey, amount: bigint) {
  return anchorIx(
    "mmf_admin",
    "permissioned_burn",
    p.admin.methods.permissionedBurn(new BN(amount.toString())).accountsStrict({
      burner,
      config: pdas.config(),
      role: pdas.role("BURNER", burner),
      mint,
      burnerAta: pdas.ata(burner, mint),
      tokenProgram: TOKEN_2022_ID,
    }),
  );
}

// Canonical action encodings - must match `TimeLock::encode_*` byte for byte,
// because the executor recomputes them and rejects any difference.
export const encodeAction = {
  forceTransfer: (fromAta: PublicKey, toAta: PublicKey, amount: bigint) =>
    Buffer.from([...fromAta.toBytes(), ...toAta.toBytes(), ...u64(amount)]),
  forceBurn: (fromAta: PublicKey, amount: bigint) => Buffer.from([...fromAta.toBytes(), ...u64(amount)]),
  setRole: (role: RoleKey, grantee: PublicKey, granted: boolean) =>
    Buffer.from([...ROLE_IDS[role], ...grantee.toBytes(), granted ? 1 : 0]),
};

/** The role a proposer must hold for each operation (see create_timelock_proposal.rs). */
export function proposerRole(op: TimeLockOp): RoleKey {
  if (op === "forceBurn" || op === "forceTransfer") return "COMPLIANCE_DELEGATE";
  // SetRole accepts any role the proposer holds; Burn/Transfer need MINTER.
  return "MINTER";
}

export function createProposal(p: Programs, proposer: PublicKey, seed: bigint, op: TimeLockOp, actionData: Buffer) {
  return anchorIx(
    "mmf_admin",
    "create_timelock_proposal",
    p.admin.methods
      .createTimelockProposal(new BN(seed.toString()), { [op]: {} } as never, actionData)
      .accountsStrict({
        proposer,
        role: pdas.role(proposerRole(op), proposer),
        timelock: pdas.timelock(seed, proposer),
        systemProgram: SYSTEM_PROGRAM_ID,
      }),
  );
}

export function respondProposal(p: Programs, responder: PublicKey, timelock: PublicKey) {
  return anchorIx(
    "mmf_admin",
    "respond_timelock_proposal",
    p.admin.methods.respondTimelockProposal().accountsStrict({
      responder,
      role: pdas.role("RESPONDER", responder),
      timelock,
    }),
  );
}

export function forceTransfer(
  p: Programs,
  delegate: PublicKey,
  mint: PublicKey,
  timelock: PublicKey,
  fromAta: PublicKey,
  toAta: PublicKey,
  amount: bigint,
) {
  const config = pdas.config();
  return anchorIx(
    "mmf_admin",
    "force_transfer",
    p.admin.methods.forceTransfer(new BN(amount.toString())).accountsStrict({
      delegate,
      config,
      role: pdas.role("COMPLIANCE_DELEGATE", delegate),
      timelock,
      mint,
      fromAta,
      toAta,
      tokenProgram: TOKEN_2022_ID,
      transferHookProgram: HOOK_ID,
      hookExtraAccountMetaList: pdas.extraMetas(mint),
      hookRateConfig: pdas.rateConfig(mint),
      // Keyed on the permanent delegate (Config PDA). It never exists: the
      // hook sees the delegate as authority and skips rate limiting.
      hookRateLimit: pdas.rateLimit(mint, config),
      eventAuthority: pdas.eventAuthority(),
      program: MMF_ADMIN_ID,
    }),
  );
}

export function forceBurn(p: Programs, delegate: PublicKey, mint: PublicKey, timelock: PublicKey, fromAta: PublicKey, amount: bigint) {
  return anchorIx(
    "mmf_admin",
    "force_burn",
    p.admin.methods.forceBurn(new BN(amount.toString())).accountsStrict({
      delegate,
      config: pdas.config(),
      role: pdas.role("COMPLIANCE_DELEGATE", delegate),
      timelock,
      mint,
      fromAta,
      tokenProgram: TOKEN_2022_ID,
      eventAuthority: pdas.eventAuthority(),
      program: MMF_ADMIN_ID,
    }),
  );
}

export function setRole(p: Programs, admin: PublicKey, grantee: PublicKey, role: RoleKey, granted: boolean, timelock: PublicKey) {
  return anchorIx(
    "mmf_admin",
    "set_role",
    p.admin.methods.setRole([...ROLE_IDS[role]], granted).accountsStrict({
      admin,
      config: pdas.config(),
      grantee,
      roleAccount: pdas.role(role, grantee),
      timelock,
      systemProgram: SYSTEM_PROGRAM_ID,
    }),
  );
}

// ---------------------------------------------------------------------------
// mmf_transfer_hook (Anchor client from the IDL)
// ---------------------------------------------------------------------------

export function initExtraMetas(p: Programs, payer: PublicKey, mint: PublicKey) {
  return anchorIx(
    "mmf_transfer_hook",
    "initialize_extra_account_meta_list_ix",
    p.hook.methods.initializeExtraAccountMetaListIx().accountsStrict({
      payer,
      mint,
      extraAccountMetaList: pdas.extraMetas(mint),
      systemProgram: SYSTEM_PROGRAM_ID,
    }),
  );
}

export function initRateConfig(p: Programs, authority: PublicKey, mint: PublicKey) {
  return anchorIx(
    "mmf_transfer_hook",
    "initialize_rate_config_ix",
    p.hook.methods.initializeRateConfigIx().accountsStrict({
      authority,
      mint,
      rateConfig: pdas.rateConfig(mint),
      systemProgram: SYSTEM_PROGRAM_ID,
    }),
  );
}

export function initRateLimit(p: Programs, payer: PublicKey, owner: PublicKey, mint: PublicKey) {
  return anchorIx(
    "mmf_transfer_hook",
    "initialize_rate_limit_ix",
    p.hook.methods.initializeRateLimitIx().accountsStrict({
      payer,
      owner,
      mint,
      rateLimit: pdas.rateLimit(mint, owner),
      systemProgram: SYSTEM_PROGRAM_ID,
    }),
  );
}

export function setRateLimit(p: Programs, authority: PublicKey, mint: PublicKey, maxAmount: bigint, windowSecs: number) {
  return anchorIx(
    "mmf_transfer_hook",
    "set_rate_limit_ix",
    p.hook.methods
      .setRateLimitIx(new BN(maxAmount.toString()), new BN(windowSecs))
      .accountsStrict({ authority, mint, rateConfig: pdas.rateConfig(mint) }),
  );
}

// ---------------------------------------------------------------------------
// Token-2022 and the ATA program (hand-built)
// ---------------------------------------------------------------------------

/** CreateIdempotent. On this mint the new account starts frozen. */
export function createAta(payer: PublicKey, owner: PublicKey, mint: PublicKey): Ix {
  return rawIx(ATA_PROGRAM_ID, "Associated Token", "create_idempotent", [
    ["payer", w(payer, true)],
    ["associated_token_account", w(pdas.ata(owner, mint))],
    ["owner", r(owner)],
    ["mint", r(mint)],
    ["system_program", r(SYSTEM_PROGRAM_ID)],
    ["token_program", r(TOKEN_2022_ID)],
  ], [1]);
}

/**
 * TransferChecked with the hook's extra accounts appended in the order the
 * extra-account-meta list resolves them.
 */
export function transferChecked(mint: PublicKey, owner: PublicKey, destOwner: PublicKey, amount: bigint): Ix {
  return rawIx(TOKEN_2022_ID, "Token-2022", "transfer_checked", [
    ["source", w(pdas.ata(owner, mint))],
    ["mint", r(mint)],
    ["destination", w(pdas.ata(destOwner, mint))],
    ["owner", r(owner, true)],
    ["hook: rate_config", r(pdas.rateConfig(mint))],
    ["hook: rate_limit", w(pdas.rateLimit(mint, owner))],
    ["hook: program", r(HOOK_ID)],
    ["hook: extra_account_meta_list", r(pdas.extraMetas(mint))],
  ], [12, ...u64(amount), DECIMALS]);
}

/** Plain BurnChecked. PermissionedBurn makes Token-2022 reject it on this mint. */
export function burnChecked(owner: PublicKey, mint: PublicKey, amount: bigint): Ix {
  return rawIx(TOKEN_2022_ID, "Token-2022", "burn_checked", [
    ["account", w(pdas.ata(owner, mint))],
    ["mint", w(mint)],
    ["owner", r(owner, true)],
  ], [15, ...u64(amount), DECIMALS]);
}

// ---------------------------------------------------------------------------
// Token ACL (sRFC-37) - hand-built, mirrors test_e2e_token_acl.rs and the
// generated clients in solana-foundation/token-acl.
// ---------------------------------------------------------------------------

/** Hands the mint's freeze authority to the Token ACL MintConfig PDA. */
export function aclCreateConfig(authority: PublicKey, mint: PublicKey): Ix {
  return rawIx(TOKEN_ACL_ID, "Token ACL", "create_config", [
    ["payer", w(authority, true)],
    ["authority", r(authority, true)],
    ["mint", w(mint)],
    ["mint_config", w(pdas.mintConfig(mint))],
    ["system_program", r(SYSTEM_PROGRAM_ID)],
    ["token_program", r(TOKEN_2022_ID)],
  ], [0, ...GATE_ID.toBytes()]);
}

export function aclTogglePermissionless(authority: PublicKey, mint: PublicKey, freeze: boolean, thaw: boolean): Ix {
  return rawIx(TOKEN_ACL_ID, "Token ACL", "toggle_permissionless_instructions", [
    ["authority", r(authority, true)],
    ["mint_config", w(pdas.mintConfig(mint))],
  ], [8, freeze ? 1 : 0, thaw ? 1 : 0]);
}

/** Anyone can call this; the gate decides by checking the allow list. */
export function aclThawPermissionless(caller: PublicKey, mint: PublicKey, owner: PublicKey, listConfig: PublicKey): Ix {
  const tokenAccount = pdas.ata(owner, mint);
  return rawIx(TOKEN_ACL_ID, "Token ACL", "thaw_permissionless", [
    ["authority (payer)", w(caller, true)],
    ["mint", r(mint)],
    ["token_account", w(tokenAccount)],
    ["flag_account", w(pdas.flag(tokenAccount))],
    ["token_account_owner", r(owner)],
    ["mint_config", r(pdas.mintConfig(mint))],
    ["token_program", r(TOKEN_2022_ID)],
    ["system_program", r(SYSTEM_PROGRAM_ID)],
    ["gating_program", r(GATE_ID)],
    ["gate: thaw_extra_metas", r(pdas.thawExtraMetas(mint))],
    ["gate: list_config", r(listConfig)],
    ["gate: wallet_entry", r(pdas.walletEntry(listConfig, owner))],
  ], [6]);
}

/** Authority freeze: the compliance "stop" button. CPIs Token-2022 FreezeAccount. */
export function aclFreeze(authority: PublicKey, mint: PublicKey, owner: PublicKey): Ix {
  return rawIx(TOKEN_ACL_ID, "Token ACL", "freeze", [
    ["authority", r(authority, true)],
    ["mint", r(mint)],
    ["token_account", w(pdas.ata(owner, mint))],
    ["mint_config", r(pdas.mintConfig(mint))],
    ["token_program", r(TOKEN_2022_ID)],
  ], [5]);
}

/** Authority thaw: works regardless of the allow list. */
export function aclThaw(authority: PublicKey, mint: PublicKey, owner: PublicKey): Ix {
  return rawIx(TOKEN_ACL_ID, "Token ACL", "thaw", [
    ["authority", r(authority, true)],
    ["mint", r(mint)],
    ["token_account", w(pdas.ata(owner, mint))],
    ["mint_config", r(pdas.mintConfig(mint))],
    ["token_program", r(TOKEN_2022_ID)],
  ], [4]);
}

// ---------------------------------------------------------------------------
// ABL gate - hand-built, mirrors test_e2e_token_acl.rs and the generated
// clients in solana-foundation/token-acl-gate.
// ---------------------------------------------------------------------------

/** Creates an Allow-mode list owned by `authority`. */
export function gateCreateList(authority: PublicKey, seed: Uint8Array): Ix {
  return rawIx(GATE_ID, "ABL gate", "create_list", [
    ["authority", r(authority, true)],
    ["payer", w(authority, true)],
    ["list_config", w(pdas.listConfig(authority, seed))],
    ["system_program", r(SYSTEM_PROGRAM_ID)],
  ], [1, 0 /* mode = Allow */, ...seed]);
}

/** Binds the list to the mint so Token ACL's permissionless thaw consults it. */
export function gateSetupExtraMetas(authority: PublicKey, mint: PublicKey, listConfig: PublicKey): Ix {
  return rawIx(GATE_ID, "ABL gate", "setup_extra_metas", [
    ["freeze_authority", r(authority, true)],
    ["payer", w(authority, true)],
    ["mint_config", r(pdas.mintConfig(mint))],
    ["mint", r(mint)],
    ["thaw_extra_metas", w(pdas.thawExtraMetas(mint))],
    ["system_program", r(SYSTEM_PROGRAM_ID)],
    ["list_config", r(listConfig)],
  ], [4]);
}

export function gateAddWallet(authority: PublicKey, listConfig: PublicKey, wallet: PublicKey): Ix {
  return rawIx(GATE_ID, "ABL gate", "add_wallet", [
    ["authority", r(authority, true)],
    ["payer", w(authority, true)],
    ["list_config", w(listConfig)],
    ["wallet", r(wallet)],
    ["wallet_entry", w(pdas.walletEntry(listConfig, wallet))],
    ["system_program", r(SYSTEM_PROGRAM_ID)],
  ], [2]);
}

export function gateRemoveWallet(authority: PublicKey, listConfig: PublicKey, wallet: PublicKey): Ix {
  return rawIx(GATE_ID, "ABL gate", "remove_wallet", [
    ["authority", w(authority, true)],
    ["list_config", w(listConfig)],
    ["wallet_entry", w(pdas.walletEntry(listConfig, wallet))],
  ], [3]);
}
