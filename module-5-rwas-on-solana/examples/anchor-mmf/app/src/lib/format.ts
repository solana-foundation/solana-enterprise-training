import { DECIMALS } from "./constants";

const SCALE = 10n ** BigInt(DECIMALS);

/** Base units to "1,234.5678". */
export function fmtAmount(base: bigint): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const whole = (v / SCALE).toLocaleString("en-US");
  const frac = (v % SCALE).toString().padStart(DECIMALS, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** "12.5" to base units, or null if it is not a valid amount. */
export function parseAmount(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  const m = s.match(/^(\d+)(?:\.(\d*))?$/);
  if (!m) return null;
  const frac = (m[2] ?? "").slice(0, DECIMALS).padEnd(DECIMALS, "0");
  return BigInt(m[1]) * SCALE + BigInt(frac || "0");
}

export const mmf = (whole: number) => BigInt(Math.round(whole * Number(SCALE)));

/** Seconds to "1d 02:03:04" / "02:03:04" / "03:04". */
export function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const hms = h > 0 || d > 0 ? `${pad(h)}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}

export function fmtWindow(secs: number): string {
  if (secs % 86400 === 0) return `${secs / 86400}d`;
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs % 60 === 0) return `${secs / 60} min`;
  return `${secs}s`;
}

export function fmtChainTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
