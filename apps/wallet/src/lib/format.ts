/**
 * QTX amount formatting — 1 QTX = 10^18 base units (same as ETH/wei scale).
 */

export const ONE_QTX = 10n ** 18n;

/** Format a raw bigint amount as a human-readable QTX string (e.g. "1.5"). */
export function formatQtx(amount: bigint): string {
  const whole = amount / ONE_QTX;
  const frac = amount % ONE_QTX;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

/**
 * Parse a human-readable QTX amount string to a raw bigint.
 * Throws if the input is not a valid non-negative decimal.
 */
export function parseQtx(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid QTX amount: "${trimmed}"`);
  }
  const [wholePart, fracPart = ""] = trimmed.split(".");
  const whole = BigInt(wholePart) * ONE_QTX;
  const fracPadded = fracPart.slice(0, 18).padEnd(18, "0");
  return whole + BigInt(fracPadded);
}

/** Shorten an address for display: "qtx1abcd…xyz9". */
export function shortAddress(addr: string | undefined | null, tail = 6): string {
  if (!addr) return "—";
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-tail)}`;
}

/** Shorten a hash/tx-hash for display. */
export function shortHash(hash: string, chars = 10): string {
  if (hash.length <= chars * 2) return hash;
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}
