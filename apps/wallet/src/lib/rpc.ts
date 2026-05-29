/**
 * JSON-RPC 2.0 client for the Quantix node.
 * Uses the browser Fetch API — no Node.js dependencies.
 */

export interface RpcBalance {
  address: string;
  balance: string;
  staked: string;
}

export interface RpcBlock {
  height: number;
  hash: string;
  timestamp: number;
  txCount: number;
  proposer: string;
}

export interface RpcValidator {
  id: string;
  address: string;
  stake: string;
  active: boolean;
}

export interface RpcMempoolEntry {
  hash: string;
  type: string;
  from: string;
  amount: string;
  fee: string;
}

// ─── Raw RPC call ─────────────────────────────────────────────────────────────

let _requestId = 1;

async function rpcCall<T>(
  endpoint: string,
  method: string,
  params: unknown[] = []
): Promise<T> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: _requestId++,
    method,
    params,
  });
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from RPC`);
  }
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) {
    throw new Error(json.error.message ?? "RPC error");
  }
  if (json.result === undefined) {
    throw new Error("RPC response missing result");
  }
  return json.result;
}

// ─── High-level methods ───────────────────────────────────────────────────────

/** Get balance and staked amounts for an address (returns strings). */
export async function getBalance(
  endpoint: string,
  address: string
): Promise<RpcBalance> {
  return rpcCall<RpcBalance>(endpoint, "qtx_getBalance", [address]);
}

/** Get the latest finalised block. */
export async function getLatestBlock(endpoint: string): Promise<RpcBlock> {
  return rpcCall<RpcBlock>(endpoint, "qtx_getLatestBlock", []);
}

/** Get all validators. */
export async function getValidators(
  endpoint: string
): Promise<RpcValidator[]> {
  return rpcCall<RpcValidator[]>(endpoint, "qtx_getValidators", []);
}

/** Get pending mempool transactions. */
export async function getMempool(
  endpoint: string
): Promise<RpcMempoolEntry[]> {
  return rpcCall<RpcMempoolEntry[]>(endpoint, "qtx_getMempool", []);
}

/** Get the next nonce for an address. */
export async function getNextNonce(
  endpoint: string,
  address: string
): Promise<number> {
  const result = await rpcCall<{ nonce: number }>(endpoint, "qtx_getBalance", [address]);
  return result.nonce;
}

/** Submit a signed transaction. Returns tx hash on success. */
export async function submitTx(
  endpoint: string,
  tx: Record<string, unknown>
): Promise<string> {
  const result = await rpcCall<{ txHash: string }>(endpoint, "qtx_submitTransaction", [tx]);
  return result.txHash;
}

/** Probe connectivity — resolves true or throws. */
export async function testConnection(endpoint: string): Promise<boolean> {
  await getLatestBlock(endpoint);
  return true;
}
