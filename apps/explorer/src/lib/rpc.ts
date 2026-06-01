import type {
  ExplorerBalance,
  ExplorerBlock,
  ExplorerChainInfo,
  ExplorerPeer,
  ExplorerReceipt,
  ExplorerTx,
  ExplorerValidator,
  RewardDistribution,
} from "./types";

const NODE_RPC_URL =
  process.env.NODE_RPC_URL ??
  process.env.NEXT_PUBLIC_RPC_URL ??
  "http://localhost:7330/rpc";

async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(NODE_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}

export function getNodeRpcUrl(): string {
  return NODE_RPC_URL;
}

export function getChainInfo(): Promise<ExplorerChainInfo> {
  return rpcCall<ExplorerChainInfo>("qtx_getChainInfo");
}

export function getLatestBlock(): Promise<ExplorerBlock> {
  return rpcCall<ExplorerBlock>("qtx_getLatestBlock");
}

export function getBlock(height: number): Promise<ExplorerBlock> {
  return rpcCall<ExplorerBlock>("qtx_getBlock", [height]);
}

export function getValidators(): Promise<ExplorerValidator[]> {
  return rpcCall<ExplorerValidator[]>("qtx_getValidators");
}

export function getMempool(): Promise<ExplorerTx[]> {
  return rpcCall<ExplorerTx[]>("qtx_getMempool");
}

export function getPeers(): Promise<ExplorerPeer[]> {
  return rpcCall<ExplorerPeer[]>("qtx_getPeers");
}

export function getRewardHistory(start: number, end: number): Promise<RewardDistribution[]> {
  return rpcCall<RewardDistribution[]>("qtx_getRewardHistory", [start, end]);
}

export function getTransaction(hash: string): Promise<ExplorerTx> {
  return rpcCall<ExplorerTx>("qtx_getTransaction", [hash]);
}

export function getReceipt(hash: string): Promise<ExplorerReceipt> {
  return rpcCall<ExplorerReceipt>("qtx_getReceipt", [hash]);
}

export function getBalance(address: string): Promise<ExplorerBalance> {
  return rpcCall<ExplorerBalance>("qtx_getBalance", [address]);
}

export function getValidatorRewards(address: string): Promise<{
  address: string;
  cumulativeRewards: string;
  lastRewardHeight: number;
}> {
  return rpcCall("qtx_getValidatorRewards", [address]);
}
