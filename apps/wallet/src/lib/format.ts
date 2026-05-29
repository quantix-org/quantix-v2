/** 1 QTX = 10^18 base units */
const QTX_DECIMALS = 18n;
const QTX_UNIT = 10n ** QTX_DECIMALS;

export function formatQtx(raw: bigint | string, decimals = 6): string {
  const n = typeof raw === "string" ? BigInt(raw) : raw;
  const whole = n / QTX_UNIT;
  const frac = n % QTX_UNIT;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function parseQtx(input: string): bigint {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty amount");
  const [wholePart, fracPart = ""] = trimmed.split(".");
  const whole = BigInt(wholePart || "0") * QTX_UNIT;
  const paddedFrac = fracPart.slice(0, 18).padEnd(18, "0");
  const frac = BigInt(paddedFrac);
  return whole + frac;
}

export function shortAddress(addr: string | undefined | null, tail = 6): string {
  if (!addr) return "—";
  return `${addr.slice(0, 8)}…${addr.slice(-tail)}`;
}

export function shortHash(hash: string | undefined | null, len = 8): string {
  if (!hash) return "—";
  return hash.slice(0, len) + "…";
}
