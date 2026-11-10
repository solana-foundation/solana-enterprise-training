import { PROGRAM_NAMES } from "./constants";

export interface DecodedError {
  /** Error identifier, e.g. `RateLimitExceeded` or `AccountFrozen`. */
  name: string;
  /** What the program said. */
  message: string;
  /** Program that raised it, when the logs say. */
  program?: string;
  /** What it means here and how to get past it. */
  hint?: string;
}

// Token-2022 shares SPL Token's first error codes.
const TOKEN_ERRORS = [
  "NotRentExempt", "InsufficientFunds", "InvalidMint", "MintMismatch", "OwnerMismatch",
  "FixedSupply", "AlreadyInUse", "InvalidNumberOfProvidedSigners", "InvalidNumberOfRequiredSigners",
  "UninitializedState", "NativeNotSupported", "NonNativeHasBalance", "InvalidInstruction",
  "InvalidState", "Overflow", "AuthorityTypeNotSupported", "MintCannotFreeze", "AccountFrozen",
  "MintDecimalsMismatch", "NonNativeNotSupported",
];

const HINTS: Record<string, string> = {
  AccountFrozen:
    "The token account is frozen. Accounts on this mint start frozen: add the owner to the allow list and thaw it first.",
  MintPaused: "The fund is paused, so Token-2022 refuses every transfer, mint and burn. Resume it in Controls.",
  RateLimitExceeded:
    "This sender has used up its cap for the current window. Wait for the reset, send less, or change the cap in Controls.",
  RateLimitMissing: "The sender has no rate-limit account. Run the 'Create rate-limit account' onboarding step first.",
  TimelockActionMismatch:
    "These parameters differ from the ones the checker approved. A proposal is bound to its exact accounts and amount.",
  TimelockNotReady: "The proposal is not accepted yet, or its delay has not passed. Approve it, then fast-forward the clock.",
  TimelockSelfResponse: "The proposer cannot approve their own proposal. A different key must check it.",
  TimelockAlreadyFinalized: "This proposal was already executed or cancelled. Create a new one.",
  TimelockMismatch: "The proposal is for a different operation than this instruction.",
  MissingRole: "This persona does not hold the role the instruction needs.",
  NotAdmin: "Only the program admin recorded in Config can do this.",
  AccountNotInitialized:
    "An account the program expected does not exist. Usually it is a Role PDA, which means the signer does not hold that role.",
  NotRateLimitAuthority: "Only the rate-limit authority (the Admin) can change the cap.",
  InsufficientFunds: "The source account does not hold enough MMF.",
  InvalidInstruction:
    "Token-2022 refused the instruction. On this mint PermissionedBurn disables plain Burn and BurnChecked, so every burn must go through mmf_admin.",
  OwnerMismatch: "The signer does not own this token account.",
  InvalidAccountData: "An account has the wrong owner or layout. A common cause on this mint is a token account that does not exist yet.",
};

const short = (s: string) => PROGRAM_NAMES[s] ?? `${s.slice(0, 4)}…${s.slice(-4)}`;

export function decodeError(logs: string[], raw: string): DecodedError {
  // The innermost failing program is the first "failed" line.
  const failedAt = logs.findIndex((l) => /^Program \w+ failed: /.test(l));
  const failed = failedAt >= 0 ? logs[failedAt].match(/^Program (\w+) failed: (.*)$/) : null;
  const program = failed ? short(failed[1]) : undefined;

  // 1. Anchor errors carry their own name and message.
  for (const l of logs) {
    const m = l.match(/Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/);
    if (m) {
      const name = m[1];
      return { name, message: m[3], program, hint: HINTS[name] };
    }
  }

  // 2. SPL-style programs log a message just before failing: take the failing
  //    program's last log line that isn't the instruction name.
  let splMsg: string | undefined;
  for (let i = failedAt - 1; i >= 0; i--) {
    const m = logs[i].match(/^Program log: (?:Error: )?(.*)$/);
    if (m && !m[1].startsWith("Instruction:")) {
      splMsg = m[1];
      break;
    }
    if (/^Program \w+ (invoke|success)/.test(logs[i])) break;
  }
  if (splMsg && /paused/i.test(splMsg)) return { name: "MintPaused", message: splMsg, program, hint: HINTS.MintPaused };
  if (splMsg && /frozen/i.test(splMsg)) return { name: "AccountFrozen", message: splMsg, program, hint: HINTS.AccountFrozen };

  // 3. Raw custom error codes.
  const source = failed?.[2] ?? raw;
  const custom = source.match(/custom program error: 0x([0-9a-f]+)/i);
  if (custom) {
    const code = parseInt(custom[1], 16);
    const tokenName = code === 0x43 ? "MintPaused" : TOKEN_ERRORS[code];
    if (program === "Token-2022" && tokenName) {
      const name = tokenName;
      return { name, message: splMsg ?? name, program, hint: HINTS[name] };
    }
    if (program === "ABL gate") {
      return {
        name: `GateRejected (0x${custom[1]})`,
        message: splMsg ?? "The gate program refused the request.",
        program,
        hint: "The ABL gate decides permissionless thaws from the allow list. This wallet is not on it, or the signer is not the list authority.",
      };
    }
    return { name: `Custom error 0x${custom[1]}`, message: splMsg ?? source, program };
  }

  const builtin = source.match(/(InvalidAccountData|AccountNotInitialized|MissingRequiredSignature|InsufficientFunds|IncorrectProgramId|InvalidArgument|AccountAlreadyInitialized)/i);
  if (builtin) {
    const name = builtin[1];
    return { name, message: splMsg ?? source, program, hint: HINTS[name] };
  }
  return { name: "TransactionFailed", message: splMsg ?? source, program };
}
