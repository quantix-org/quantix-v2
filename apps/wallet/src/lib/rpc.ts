/**
 * RPC client — all requests go through /api/rpc (Next.js API route proxy)
 * which forwards to the node and avoids CORS.
 *
 * Tx serialisation: amount / fee must be strings (BigInt not JSON-safe).
 * Params MUST be an array [] per the node's JSON-RPC 2.0 implementation.
 */

const RPC_ENDPOINT = "/api/rpc";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RpcBlock {
  height: number;
  hash: string;
  timestamp: number;
  txCount: number;
  proposer: string;
}

export interface RpcBalance {
  address: string;
  balance: string;  // base units as decimal string
  staked: string;
  nonce: number;
}

export interface RpcValidator {
  address: string;
  stake: string;
  active: boolean;
}

export interface RpcTx {
  type: string;
  from: string;
  to?: string;
  amount: string;
  fee: string;
  nonce: number;
  timestamp: number;
  txHash?: string;
}

export interface RpcSubmitResult {
  txHash: string;
}

export interface FaucetResult {
  txHash: string;
  amount: string;
  to: string;
}

// ── Wire transaction for submitTx ─────────────────────────────────────────────

export interface WireTx {
  type: string;
  chainId: string;
  from: string;
  nonce: number;
  timestamp: number;
  amount: string;
  fee: string;
  to?: string;
  validatorId?: string;
  signerPublicKey: string;
  signature: string;
}

// ── Core fetch ───────────────────────────────────────────────────────────────

async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  return json.result as T;
}

// ── API calls ────────────────────────────────────────────────────────────────

export async function getLatestBlock(): Promise<RpcBlock> {
  return rpcCall<RpcBlock>("qtx_getLatestBlock");
}

export async function getBlock(height: number): Promise<RpcBlock> {
  return rpcCall<RpcBlock>("qtx_getBlock", [height]);
}

export async function getBalance(address: string): Promise<RpcBalance> {
  return rpcCall<RpcBalance>("qtx_getBalance", [address]);
}

export async function getValidators(): Promise<RpcValidator[]> {
  return rpcCall<RpcValidator[]>("qtx_getValidators");
}

export async function getMempool(): Promise<RpcTx[]> {
  return rpcCall<RpcTx[]>("qtx_getMempool");
}

export async function getNextNonce(address: string): Promise<number> {
  const bal = await getBalance(address);
  return bal.nonce + 1;
}

export async function submitTx(tx: WireTx): Promise<RpcSubmitResult> {
  return rpcCall<RpcSubmitResult>("qtx_submitTransaction", [tx]);
}

export async function requestFaucet(address: string): Promise<FaucetResult> {
  const res = await fetch("/api/faucet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? data?.message ?? `HTTP ${res.status}`);
  }
  return data as FaucetResult;
}

// ── Signing payload (must match packages/protocol/src/transactions.ts) ────────

export function transactionSigningPayload(tx: {
  chainId: string;
  type: string;
  from: string;
  nonce: number;
  timestamp: number;
  amount: bigint;
  fee: bigint;
  to?: string;
  validatorId?: string;
}): string {
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
  });
}
