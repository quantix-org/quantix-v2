import { sha256 } from "@noble/hashes/sha2.js";

export const ACTIVE_ADDRESS_KEY = "quantix_active_address_v1";
export const ACCOUNTS_KEY = "quantix_accounts_v1";
export const PERMISSIONS_KEY = "quantix_origin_permissions_v1";
export const RPC_ENDPOINT_KEY = "quantix_rpc_endpoint_v1";
export const APPROVAL_REQUESTS_KEY = "quantix_approval_requests_v1";

export const DEFAULT_RPC_ENDPOINT = "https://rpc1.qpqb.org";
export const DEFAULT_CHAIN_ID = "quantix-devnet";
export const ONE_QTX = 10n ** 18n;

export type StoredAccount = {
  address: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
};

export type AccountMap = Record<string, StoredAccount>;

export type QuantixPermission = {
  origin: string;
  address: string;
  connectedAt: number;
};

export type PermissionMap = Record<string, QuantixPermission>;

export type SignedTx = {
  chainId: string;
  type: string;
  from: string;
  nonce: number;
  timestamp: number;
  amount: bigint;
  fee: bigint;
  signerPublicKey: string;
  signature: string;
  to?: string;
  validatorId?: string;
  contractAddress?: string;
  contractCode?: string;
  method?: string;
  args?: unknown[];
  gasLimit?: number;
  maxFeePerGas?: bigint;
  value?: bigint;
  salt?: string;
};

export type ApprovalMethod = "quantix_signMessage" | "quantix_sendTransaction" | "quantix_contractSend";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRequestRecord = {
  id: string;
  origin: string;
  method: ApprovalMethod;
  params?: unknown;
  address?: string;
  createdAt: number;
  status: ApprovalStatus;
  decidedAt?: number;
  reason?: string;
};

export function isValidQtxAddress(value: string): boolean {
  return value.startsWith("qtx1") && value.length === 42;
}

export function isValidRpcEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function asWalletAccount(value: unknown): StoredAccount {
  if (typeof value !== "object" || value === null) {
    throw new Error("Wallet JSON must be an object.");
  }

  const obj = value as Record<string, unknown>;
  const address = String(obj.address ?? "").trim();
  const publicKey = String(obj.publicKey ?? "").trim();
  const privateKey = String(obj.privateKey ?? "").trim();

  if (!isValidQtxAddress(address)) throw new Error("Wallet address is invalid.");
  if (!/^[0-9a-fA-F]+$/.test(publicKey) || publicKey.length < 64) throw new Error("Wallet publicKey is invalid.");
  if (!/^[0-9a-fA-F]+$/.test(privateKey) || privateKey.length < 64) throw new Error("Wallet privateKey is invalid.");

  return {
    address,
    publicKey,
    privateKey,
    createdAt: Date.now(),
  };
}

export function parseBigIntLike(value: unknown, fallback: bigint): bigint {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error("Numeric value must be an integer.");
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) throw new Error(`Invalid numeric string: ${value}`);
    return BigInt(trimmed);
  }
  throw new Error("Unsupported numeric value type.");
}

export function parseQtxToBaseUnits(input: string): bigint {
  const raw = input.trim();
  if (!raw) return 0n;
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid QTX amount: ${raw}`);
  }

  const [wholePart, fracPart = ""] = raw.split(".");
  if (fracPart.length > 18) {
    throw new Error("QTX amount max 18 decimal places.");
  }

  const whole = BigInt(wholePart || "0");
  const frac = BigInt((fracPart + "0".repeat(18)).slice(0, 18));
  return whole * ONE_QTX + frac;
}

export function parseTokenToBaseUnits(input: string, decimalsRaw: string): bigint {
  const raw = input.trim();
  if (!raw) return 0n;
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid token amount: ${raw}`);
  }

  const decimals = Number(decimalsRaw);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new Error("Token decimals must be an integer 0..30.");
  }

  const [wholePart, fracPart = ""] = raw.split(".");
  if (fracPart.length > decimals) {
    throw new Error(`Token amount max ${decimals} decimal places.`);
  }

  const whole = BigInt(wholePart || "0");
  const frac = BigInt((fracPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  return whole * (10n ** BigInt(decimals)) + frac;
}

export function formatQtx(raw: string): string {
  if (!/^\d+$/.test(raw)) return "0";
  const value = BigInt(raw);
  const whole = value / ONE_QTX;
  const frac = value % ONE_QTX;
  if (frac === 0n) return `${whole.toString()} QTX`;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr.slice(0, 6)} QTX`;
}

export function transactionSigningPayload(tx: SignedTx): string {
  return JSON.stringify({
    chainId: tx.chainId,
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    to: tx.to ?? null,
    validatorId: tx.validatorId ?? null,
    contractAddress: tx.contractAddress ?? null,
    contractCode: tx.contractCode ?? null,
    method: tx.method ?? null,
    args: tx.args ?? [],
    gasLimit: tx.gasLimit ?? null,
    maxFeePerGas: tx.maxFeePerGas?.toString() ?? null,
    value: tx.value?.toString() ?? null,
    salt: tx.salt ?? null,
  });
}

export function serializeSignedTx(tx: SignedTx): Record<string, unknown> {
  const out: Record<string, unknown> = {
    chainId: tx.chainId,
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    signerPublicKey: tx.signerPublicKey,
    signature: tx.signature,
  };

  if (tx.to !== undefined) out.to = tx.to;
  if (tx.validatorId !== undefined) out.validatorId = tx.validatorId;
  if (tx.contractAddress !== undefined) out.contractAddress = tx.contractAddress;
  if (tx.contractCode !== undefined) out.contractCode = tx.contractCode;
  if (tx.method !== undefined) out.method = tx.method;
  if (tx.args !== undefined) out.args = tx.args;
  if (tx.gasLimit !== undefined) out.gasLimit = tx.gasLimit;
  if (tx.maxFeePerGas !== undefined) out.maxFeePerGas = tx.maxFeePerGas.toString();
  if (tx.value !== undefined) out.value = tx.value.toString();
  if (tx.salt !== undefined) out.salt = tx.salt;

  return out;
}

export function deriveAddressFromPublicKey(publicKeyHex: string): string {
  const digest = sha256(new TextEncoder().encode(publicKeyHex));
  const short = Array.from(digest)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 38);
  return `qtx1${short}`;
}
