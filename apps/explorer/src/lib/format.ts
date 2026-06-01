const QTX_DECIMALS = 18n;
const QTX_UNIT = 10n ** QTX_DECIMALS;

function toBigIntSafe(raw: bigint | string | number | null | undefined): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return 0n;
    return BigInt(Math.trunc(raw));
  }
  if (typeof raw === "string") {
    const normalized = raw.trim();
    if (!normalized) return 0n;
    try {
      return BigInt(normalized);
    } catch {
      // Fallback for accidental decimal/string-number payloads from RPC.
      const maybeNum = Number(normalized);
      if (!Number.isFinite(maybeNum)) return 0n;
      return BigInt(Math.trunc(maybeNum));
    }
  }
  return 0n;
}

export function formatQtx(raw: bigint | string | number | null | undefined, decimals = 6): string {
  const n = toBigIntSafe(raw);
  const whole = n / QTX_UNIT;
  const frac = n % QTX_UNIT;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function formatQtxCompact(raw: bigint | string | number | null | undefined, decimals = 4): string {
  const n = toBigIntSafe(raw);
  const whole = n / QTX_UNIT;
  const frac = n % QTX_UNIT;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function shortAddress(addr: string | undefined | null, tail = 6): string {
  if (!addr) return "—";
  return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-tail)}` : addr;
}

export function shortHash(hash: string | undefined | null, len = 8): string {
  if (!hash) return "—";
  return hash.length > len + 3 ? `${hash.slice(0, len)}…${hash.slice(-6)}` : hash;
}

export function formatTime(ts: number): string {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function badgeClass(kind: "green" | "red" | "gray" | "blue" | "orange" | "yellow" = "gray") {
  return `badge b-${kind}`;
}
