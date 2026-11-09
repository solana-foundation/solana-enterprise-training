import { Program, type Provider } from "@anchor-lang/core";
import type { Connection } from "@solana/web3.js";

// IDLs and types come straight from `anchor build`, so the console always
// matches the programs it talks to.
import mmfAdminIdl from "../../../target/idl/mmf_admin.json";
import hookIdl from "../../../target/idl/mmf_transfer_hook.json";
import type { MmfAdmin } from "../../../target/types/mmf_admin";
import type { MmfTransferHook } from "../../../target/types/mmf_transfer_hook";

export interface Programs {
  admin: Program<MmfAdmin>;
  hook: Program<MmfTransferHook>;
}

export function makePrograms(connection: Connection): Programs {
  // A read-only provider is enough: the console signs with persona keypairs
  // itself, so Anchor is only used to encode instructions and decode accounts.
  const provider = { connection } as Provider;
  return {
    admin: new Program<MmfAdmin>(mmfAdminIdl as unknown as MmfAdmin, provider),
    hook: new Program<MmfTransferHook>(hookIdl as unknown as MmfTransferHook, provider),
  };
}

type IdlLike = { instructions: { name: string; accounts: { name: string }[] }[] };

/** Account names for an instruction, in the order Anchor serializes them. */
export function idlAccountNames(program: "mmf_admin" | "mmf_transfer_hook", ix: string): string[] {
  const idl = (program === "mmf_admin" ? mmfAdminIdl : hookIdl) as unknown as IdlLike;
  return idl.instructions.find((i) => i.name === ix)?.accounts.map((a) => a.name) ?? [];
}

export const IDL_ERRORS: Record<string, { code: number; name: string; msg: string }[]> = {
  mmf_admin: mmfAdminIdl.errors,
  mmf_transfer_hook: hookIdl.errors,
};
