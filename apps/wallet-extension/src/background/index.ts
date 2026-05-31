import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";

const PERMISSIONS_KEY = "quantix_origin_permissions_v1";
const ACTIVE_ADDRESS_KEY = "quantix_active_address_v1";
const ACCOUNTS_KEY = "quantix_accounts_v1";
const RPC_ENDPOINT_KEY = "quantix_rpc_endpoint_v1";
const DEFAULT_RPC_ENDPOINT = "http://127.0.0.1:7330/rpc";
const DEFAULT_CHAIN_ID = "quantix-devnet";

type QuantixPermission = {
  origin: string;
  address: string;
  connectedAt: number;
};

type PermissionMap = Record<string, QuantixPermission>;
type AccountMap = Record<string, StoredAccount>;

type StoredAccount = {
  address: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
};

type ProviderRequest = {
  id: string;
  method: string;
  params?: unknown;
};

type ProviderResponse = {
  channel: "quantix:provider-response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type TxType = "transfer" | "stake" | "unstake" | "validator_register";

type SendTransactionParams = {
  type: TxType;
  to?: string;
  amount: string | number | bigint;
  fee?: string | number | bigint;
  nonce?: number;
  chainId?: string;
  validatorId?: string;
};

type ContractCallLikeParams = {
  contractAddress: string;
  method: string;
  args?: unknown[];
  amount?: string | number | bigint;
  fee?: string | number | bigint;
  gasLimit?: number;
  maxFeePerGas?: string | number | bigint;
  value?: string | number | bigint;
  nonce?: number;
  chainId?: string;
};

type SignedTx = {
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
  method?: string;
  args?: unknown[];
  gasLimit?: number;
  maxFeePerGas?: bigint;
  value?: bigint;
};

async function readStorage<T>(key: string, fallback: T): Promise<T> {
  const data = await chrome.storage.local.get(key);
  return (data[key] as T | undefined) ?? fallback;
}

async function writeStorage<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

function failure(id: string, code: number, message: string): ProviderResponse {
  return {
    channel: "quantix:provider-response",
    id,
    ok: false,
    error: { code, message },
  };
}

function success(id: string, result: unknown): ProviderResponse {
  return {
    channel: "quantix:provider-response",
    id,
    ok: true,
    result,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Invalid hex value.");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function deriveAddressFromPublicKey(publicKeyHex: string): string {
  const digest = sha256(new TextEncoder().encode(publicKeyHex));
  return `qtx1${bytesToHex(digest).slice(0, 38)}`;
}

function parseBigIntLike(value: unknown, fallback: bigint): bigint {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error("Numeric value must be an integer.");
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) throw new Error(`Invalid numeric string: ${value}`);
    return BigInt(trimmed);
  }
  throw new Error("Unsupported numeric value type.");
}

function transactionSigningPayload(tx: SignedTx): string {
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
    contractCode: null,
    method: tx.method ?? null,
    args: tx.args ?? [],
    gasLimit: tx.gasLimit ?? null,
    maxFeePerGas: tx.maxFeePerGas?.toString() ?? null,
    value: tx.value?.toString() ?? null,
    salt: null,
  });
}

function serializeSignedTx(tx: SignedTx): Record<string, unknown> {
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
  if (tx.method !== undefined) out.method = tx.method;
  if (tx.args !== undefined) out.args = tx.args;
  if (tx.gasLimit !== undefined) out.gasLimit = tx.gasLimit;
  if (tx.maxFeePerGas !== undefined) out.maxFeePerGas = tx.maxFeePerGas.toString();
  if (tx.value !== undefined) out.value = tx.value.toString();

  return out;
}

function decodeReturnData(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const raw = String(value);
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }

  if (/^-?\d+$/.test(trimmed)) {
    try {
      return BigInt(trimmed);
    } catch {
      return raw;
    }
  }

  return raw;
}

async function rpcCall<T>(rpcEndpoint: string, method: string, params: unknown[]): Promise<T> {
  const trimmed = rpcEndpoint.trim();
  const normalizedBase = trimmed || DEFAULT_RPC_ENDPOINT;
  const normalized = normalizedBase.endsWith("/rpc") ? normalizedBase : `${normalizedBase.replace(/\/+$/, "")}/rpc`;

  const candidates = new Set<string>([normalized]);
  if (normalized.includes("127.0.0.1")) candidates.add(normalized.replace("127.0.0.1", "localhost"));
  if (normalized.includes("localhost")) candidates.add(normalized.replace("localhost", "127.0.0.1"));

  let lastError = "unknown network error";

  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });

      if (!response.ok) {
        lastError = `HTTP ${response.status} from ${endpoint}`;
        continue;
      }

      const json = (await response.json()) as { result?: T; error?: { message?: string } };
      if (json.error) {
        throw new Error(json.error.message ?? "RPC error");
      }

      return json.result as T;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`Cannot reach RPC endpoint. Tried: ${Array.from(candidates).join(", ")}. Last error: ${lastError}`);
}

async function getRpcEndpoint(): Promise<string> {
  const value = await readStorage<string>(RPC_ENDPOINT_KEY, DEFAULT_RPC_ENDPOINT);
  return value.trim() || DEFAULT_RPC_ENDPOINT;
}

async function getAccounts(): Promise<AccountMap> {
  return readStorage<AccountMap>(ACCOUNTS_KEY, {});
}

async function getActiveAddress(): Promise<string | null> {
  return readStorage<string | null>(ACTIVE_ADDRESS_KEY, null);
}

async function ensureActiveAccount(): Promise<StoredAccount> {
  const accounts = await getAccounts();
  const activeAddress = await getActiveAddress();
  if (activeAddress && accounts[activeAddress]) {
    return accounts[activeAddress];
  }

  const generated = ml_dsa87.keygen();
  const publicKey = bytesToHex(generated.publicKey);
  const privateKey = bytesToHex(generated.secretKey);
  const address = deriveAddressFromPublicKey(publicKey);

  const account: StoredAccount = {
    address,
    publicKey,
    privateKey,
    createdAt: Date.now(),
  };

  const nextAccounts = { ...accounts, [address]: account };
  await writeStorage(ACCOUNTS_KEY, nextAccounts);
  await writeStorage(ACTIVE_ADDRESS_KEY, address);
  return account;
}

async function getSignerForOrigin(origin: string): Promise<StoredAccount> {
  const permissions = await readStorage<PermissionMap>(PERMISSIONS_KEY, {});
  const granted = permissions[origin];
  if (!granted) {
    throw new Error("Origin is not connected. Call quantix_connect first.");
  }

  const accounts = await getAccounts();
  const signer = accounts[granted.address];
  if (!signer) {
    throw new Error("No signer found for active address. Import account in extension settings.");
  }
  return signer;
}

async function getNextNonce(rpcEndpoint: string, address: string): Promise<number> {
  const balance = await rpcCall<{ nonce: number }>(rpcEndpoint, "qtx_getBalance", [address]);
  return balance.nonce + 1;
}

function signTx(unsigned: Omit<SignedTx, "signature">, privateKeyHex: string): SignedTx {
  const payload = transactionSigningPayload({ ...unsigned, signature: "" });
  const sigBytes = ml_dsa87.sign(new TextEncoder().encode(payload), hexToBytes(privateKeyHex));
  return {
    ...unsigned,
    signature: bytesToHex(sigBytes),
  };
}

function parseSendParams(params: unknown): SendTransactionParams {
  if (typeof params !== "object" || params === null) {
    throw new Error("quantix_sendTransaction requires an object params.");
  }
  return params as SendTransactionParams;
}

function parseContractCallParams(params: unknown): ContractCallLikeParams {
  if (typeof params !== "object" || params === null) {
    throw new Error("Contract params must be an object.");
  }
  return params as ContractCallLikeParams;
}

async function buildSignedContractCallTx(origin: string, params: unknown): Promise<SignedTx> {
  const signer = await getSignerForOrigin(origin);
  const input = parseContractCallParams(params);
  if (!input.contractAddress || !input.method) {
    throw new Error("contractAddress and method are required.");
  }

  const rpcEndpoint = await getRpcEndpoint();
  const nonce = input.nonce ?? await getNextNonce(rpcEndpoint, signer.address);
  const amount = parseBigIntLike(input.amount, 0n);
  const fee = parseBigIntLike(input.fee, 0n);
  const maxFeePerGas = parseBigIntLike(input.maxFeePerGas, 0n);
  const value = parseBigIntLike(input.value, amount);

  const unsigned: Omit<SignedTx, "signature"> = {
    chainId: input.chainId ?? DEFAULT_CHAIN_ID,
    type: "contract_call",
    from: signer.address,
    nonce,
    timestamp: Date.now(),
    amount,
    fee,
    signerPublicKey: signer.publicKey,
    contractAddress: input.contractAddress,
    method: input.method,
    args: input.args ?? [],
    gasLimit: input.gasLimit ?? 300_000,
    maxFeePerGas,
    value,
  };

  return signTx(unsigned, signer.privateKey);
}

async function handleRequest(origin: string, req: ProviderRequest): Promise<ProviderResponse> {
  if (!req.method.startsWith("quantix_")) {
    return failure(req.id, 4200, "Unsupported method: only quantix_ namespace is allowed.");
  }

  const permissions = await readStorage<PermissionMap>(PERMISSIONS_KEY, {});

  switch (req.method) {
    case "quantix_connect": {
      const account = await ensureActiveAccount();
      permissions[origin] = {
        origin,
        address: account.address,
        connectedAt: Date.now(),
      };
      await writeStorage(PERMISSIONS_KEY, permissions);
      return success(req.id, {
        address: account.address,
        chainId: DEFAULT_CHAIN_ID,
      });
    }

    case "quantix_getActiveAddress": {
      const granted = permissions[origin];
      return success(req.id, granted?.address ?? null);
    }

    case "quantix_signMessage": {
      try {
        const signer = await getSignerForOrigin(origin);
        const params = req.params;
        const message = typeof params === "string"
          ? params
          : typeof params === "object" && params !== null && typeof (params as { message?: unknown }).message === "string"
          ? String((params as { message: string }).message)
          : "";

        if (!message) {
          return failure(req.id, -32602, "quantix_signMessage requires non-empty message.");
        }

        const signature = bytesToHex(ml_dsa87.sign(new TextEncoder().encode(message), hexToBytes(signer.privateKey)));
        return success(req.id, {
          address: signer.address,
          publicKey: signer.publicKey,
          signature,
          message,
        });
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        return failure(req.id, 4100, text);
      }
    }

    case "quantix_sendTransaction": {
      try {
        const signer = await getSignerForOrigin(origin);
        const input = parseSendParams(req.params);
        const rpcEndpoint = await getRpcEndpoint();
        const nonce = input.nonce ?? await getNextNonce(rpcEndpoint, signer.address);
        const amount = parseBigIntLike(input.amount, 0n);
        const fee = parseBigIntLike(input.fee, 0n);

        if (!input.type) {
          return failure(req.id, -32602, "Transaction type is required.");
        }

        const unsignedBase: Omit<SignedTx, "signature"> = {
          chainId: input.chainId ?? DEFAULT_CHAIN_ID,
          type: input.type,
          from: signer.address,
          nonce,
          timestamp: Date.now(),
          amount,
          fee,
          signerPublicKey: signer.publicKey,
        };

        if (input.type === "transfer") {
          if (!input.to) return failure(req.id, -32602, "transfer requires recipient 'to'.");
          unsignedBase.to = input.to;
        }

        if (input.type === "validator_register") {
          unsignedBase.validatorId = input.validatorId ?? signer.address;
        }

        const tx = signTx(unsignedBase, signer.privateKey);
        const result = await rpcCall<{ txHash: string }>(rpcEndpoint, "qtx_submitTransaction", [serializeSignedTx(tx)]);
        return success(req.id, result);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        return failure(req.id, -32603, text);
      }
    }

    case "quantix_contractCall": {
      try {
        const tx = await buildSignedContractCallTx(origin, req.params);
        const rpcEndpoint = await getRpcEndpoint();
        const result = await rpcCall<Record<string, unknown>>(rpcEndpoint, "qtx_call", [serializeSignedTx(tx)]);
        const decoded = decodeReturnData((result.receipt as { returnData?: unknown } | undefined)?.returnData);
        return success(req.id, {
          ...result,
          decodedReturnData: decoded,
        });
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        return failure(req.id, -32603, text);
      }
    }

    case "quantix_contractSend": {
      try {
        const tx = await buildSignedContractCallTx(origin, req.params);
        const rpcEndpoint = await getRpcEndpoint();
        const result = await rpcCall<{ txHash: string }>(rpcEndpoint, "qtx_submitTransaction", [serializeSignedTx(tx)]);
        return success(req.id, result);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        return failure(req.id, -32603, text);
      }
    }

    default:
      return failure(req.id, 4200, `Unsupported quantix method: ${req.method}`);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const currentRpc = await readStorage<string | null>(RPC_ENDPOINT_KEY, null);
  if (!currentRpc) {
    await writeStorage(RPC_ENDPOINT_KEY, DEFAULT_RPC_ENDPOINT);
  }
  await ensureActiveAccount();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
  if (!message || typeof message !== "object") return;

  const tagged = message as { type?: unknown };
  if (tagged.type === "quantix:internal-rpc") {
    const payload = message as {
      rpcEndpoint?: unknown;
      method?: unknown;
      params?: unknown;
    };

    const rpcEndpoint = String(payload.rpcEndpoint ?? "");
    const method = String(payload.method ?? "");
    const params = Array.isArray(payload.params) ? payload.params : [];

    rpcCall<unknown>(rpcEndpoint, method, params)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => {
        const text = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: text });
      });

    return true;
  }

  if (tagged.type !== "quantix:provider-request") return;

  const payload = message as { origin?: unknown; request?: ProviderRequest };
  const origin = String(payload.origin ?? "");
  const request = payload.request as ProviderRequest;

  handleRequest(origin, request)
    .then(sendResponse)
    .catch((err) => {
      const text = err instanceof Error ? err.message : String(err);
      sendResponse(failure(request.id, -32603, text));
    });

  return true;
});

export {};
