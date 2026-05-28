/**
 * @quantix/sdk — Client library for building, signing, and submitting
 * transactions to a Quantix node over JSON-RPC.
 */

import { signPqMessage } from "@quantix/crypto";
import { transactionSigningPayload } from "@quantix/protocol";
import type { Transaction, Address } from "@quantix/protocol";

// ─── Re-exports ─────────────────────────────────────────────────────────────

export {
  generatePqKeyPair as generateKeyPair,
  deriveAddressFromPublicKey as deriveAddress,
} from "@quantix/crypto";
export type { PqKeyPair } from "@quantix/crypto";
export type { Transaction, Address } from "@quantix/protocol";

// ─── Result types ────────────────────────────────────────────────────────────

export interface BalanceResult {
  address: string;
  balance: bigint;
  nonce: number;
  staked: bigint;
}

export interface BlockResult {
  height: number;
  hash: string;
}

export interface BlockDetailResult {
  height: number;
  hash: string;
  txCount: number;
  committed: boolean;
  timestamp: number;
}

export interface ValidatorInfo {
  id: string;
  owner: string;
  stake: bigint;
  active: boolean;
  missedBlocks: number;
  slashed: boolean;
}

export interface SubmitResult {
  txHash: string;
}

export interface MempoolEntry {
  hash: string;
  from: string;
  nonce: number;
  type: string;
}

export interface PeerInfo {
  id: string;
  endpoint: string;
}

/** Error thrown when the node returns a JSON-RPC error response. */
export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

// ─── Transaction builder params ──────────────────────────────────────────────

interface BaseTxParams {
  from: Address;
  nonce: number;
  amount: bigint;
  fee?: bigint;
  signerPublicKey: string;
  privateKey: string;
}

export interface TransferParams extends BaseTxParams {
  to: Address;
}

export type StakeParams = BaseTxParams;
export type UnstakeParams = BaseTxParams;

export interface ValidatorRegisterParams extends BaseTxParams {
  validatorId: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function sign(tx: Omit<Transaction, "signature">, privateKey: string): Transaction {
  const unsigned: Transaction = { ...(tx as Transaction), signature: "" };
  const payload = transactionSigningPayload(unsigned);
  const signature = signPqMessage(privateKey, payload);
  return { ...unsigned, signature };
}

/** Serialize a Transaction for JSON-RPC submission (bigint → string). */
function serializeTx(tx: Transaction): Record<string, unknown> {
  const out: Record<string, unknown> = {
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
  return out;
}

async function rpcCall<T>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (cause) {
    throw new Error(`Network error connecting to ${endpoint}: ${String(cause)}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }

  const json = (await response.json()) as {
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  };

  if (json.error) {
    throw new RpcError(json.error.message, json.error.code, json.error.data);
  }

  return json.result as T;
}

// ─── Transaction builders ─────────────────────────────────────────────────────

/**
 * Build and sign a transfer transaction.
 * Sends `amount` QTX from `from` to `to`.
 */
export function buildTransferTx(params: TransferParams): Transaction {
  return sign(
    {
      type: "transfer",
      from: params.from,
      to: params.to,
      nonce: params.nonce,
      timestamp: Date.now(),
      amount: params.amount,
      fee: params.fee ?? 0n,
      signerPublicKey: params.signerPublicKey,
    },
    params.privateKey,
  );
}

/**
 * Build and sign a stake transaction.
 * Stakes `amount` QTX from the `from` account.
 */
export function buildStakeTx(params: StakeParams): Transaction {
  return sign(
    {
      type: "stake",
      from: params.from,
      nonce: params.nonce,
      timestamp: Date.now(),
      amount: params.amount,
      fee: params.fee ?? 0n,
      signerPublicKey: params.signerPublicKey,
    },
    params.privateKey,
  );
}

/**
 * Build and sign an unstake transaction.
 * Unstakes `amount` QTX back to the `from` account.
 */
export function buildUnstakeTx(params: UnstakeParams): Transaction {
  return sign(
    {
      type: "unstake",
      from: params.from,
      nonce: params.nonce,
      timestamp: Date.now(),
      amount: params.amount,
      fee: params.fee ?? 0n,
      signerPublicKey: params.signerPublicKey,
    },
    params.privateKey,
  );
}

/**
 * Build and sign a validator_register transaction.
 * Registers `validatorId` as a validator with the given stake.
 */
export function buildValidatorRegisterTx(params: ValidatorRegisterParams): Transaction {
  return sign(
    {
      type: "validator_register",
      from: params.from,
      validatorId: params.validatorId,
      nonce: params.nonce,
      timestamp: Date.now(),
      amount: params.amount,
      fee: params.fee ?? 0n,
      signerPublicKey: params.signerPublicKey,
    },
    params.privateKey,
  );
}

// ─── Chain queries ───────────────────────────────────────────────────────────

/**
 * Fetch the balance, nonce, and staked amount for an address.
 */
export async function getBalance(
  rpcEndpoint: string,
  address: Address,
): Promise<BalanceResult> {
  const raw = await rpcCall<{
    address: string;
    balance: string;
    nonce: number;
    staked: string;
  }>(rpcEndpoint, "qtx_getBalance", [address]);

  return {
    address: raw.address,
    balance: BigInt(raw.balance),
    nonce: raw.nonce,
    staked: BigInt(raw.staked),
  };
}

/**
 * Fetch the latest committed block height and hash.
 */
export async function getLatestBlock(rpcEndpoint: string): Promise<BlockResult> {
  return rpcCall<BlockResult>(rpcEndpoint, "qtx_getLatestBlock", []);
}

/**
 * Fetch a specific block by height.
 * Throws `RpcError` (code -32004) if the block does not exist.
 */
export async function getBlock(
  rpcEndpoint: string,
  height: number,
): Promise<BlockDetailResult> {
  return rpcCall<BlockDetailResult>(rpcEndpoint, "qtx_getBlock", [height]);
}

/**
 * Fetch all registered validators and their current status.
 */
export async function getValidators(rpcEndpoint: string): Promise<ValidatorInfo[]> {
  const raw = await rpcCall<
    Array<{
      id: string;
      owner: string;
      stake: string;
      active: boolean;
      missedBlocks: number;
      slashed: boolean;
    }>
  >(rpcEndpoint, "qtx_getValidators", []);

  return raw.map((v) => ({ ...v, stake: BigInt(v.stake) }));
}

/**
 * Fetch the current mempool — pending transactions not yet committed to a block.
 */
export async function getMempool(rpcEndpoint: string): Promise<MempoolEntry[]> {
  return rpcCall<MempoolEntry[]>(rpcEndpoint, "qtx_getMempool", []);
}

/**
 * Fetch the list of peers known to this node.
 */
export async function getPeers(rpcEndpoint: string): Promise<PeerInfo[]> {
  return rpcCall<PeerInfo[]>(rpcEndpoint, "qtx_getPeers", []);
}

/**
 * Convenience: return the next valid nonce for `address` (chain nonce + 1).
 * Use this to populate the `nonce` field of a new transaction.
 */
export async function getNextNonce(rpcEndpoint: string, address: Address): Promise<number> {
  const { nonce } = await getBalance(rpcEndpoint, address);
  return nonce + 1;
}

// ─── Submission ───────────────────────────────────────────────────────────────

/**
 * Submit a signed transaction to the node.
 * Returns the transaction hash on success; throws `RpcError` on rejection.
 */
export async function submitTx(
  rpcEndpoint: string,
  tx: Transaction,
): Promise<SubmitResult> {
  return rpcCall<SubmitResult>(rpcEndpoint, "qtx_submitTransaction", [serializeTx(tx)]);
}
