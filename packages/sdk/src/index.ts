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

export interface ContractCodeResult {
  address: string;
  owner: string;
  codeHash: string;
  code: string;
  deployedAtHeight: number;
  salt: string | null;
}

export interface ContractReceiptResult {
  txHash: string;
  type: "contract_deploy" | "contract_call";
  contractAddress: string;
  success: boolean;
  gasUsed: number;
  blockHeight: number;
  returnData?: string;
  error?: string;
}

export interface ContractEventResult {
  txHash: string;
  contractAddress: string;
  name: string;
  data: string;
  blockHeight: number;
}

export interface ContractStorageResult {
  contractAddress: string;
  storage?: Record<string, string>;
  key?: string;
  value?: string | null;
}

export interface DecodedContractCallResult {
  success: boolean;
  error?: string;
  contractAddress?: string;
  receipt?: ContractReceiptResult | null;
  storage?: Record<string, string>;
  decodedReturnData?: unknown;
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
  chainId: string;
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

export interface ContractDeployParams extends BaseTxParams {
  contractCode: string;
  gasLimit: number;
  maxFeePerGas?: bigint;
  value?: bigint;
  salt?: string;
  contractAddress?: string;
}

export interface ContractCallParams extends BaseTxParams {
  contractAddress: Address;
  method: string;
  args?: unknown[];
  gasLimit: number;
  maxFeePerGas?: bigint;
  value?: bigint;
}

export interface QtxVmV1DeployParams extends Omit<ContractDeployParams, "contractCode"> {
  contract: QtxVmV1ContractDefinition | Record<string, QtxVmV1Instruction[]>;
  /**
   * Encoding strategy for contractCode.
   * - "hex" (default): RPC-safe for qtx_sendTransaction.
   * - "json": raw JSON string, useful for direct protocol-level tests.
   */
  encoding?: "hex" | "json";
}

export interface QtxVmV1CallParams extends Omit<ContractCallParams, "method" | "args"> {
  method: string;
  args?: unknown[];
}

export type QtxVmV1Op = "set" | "add" | "delete" | "emit" | "return";

export interface QtxVmV1Instruction {
  op: QtxVmV1Op;
  key?: string;
  arg?: number | string;
  value?: unknown;
  name?: string;
  data?: unknown;
}

export interface QtxVmV1ContractDefinition {
  vm: "qtx-v1";
  methods: Record<string, QtxVmV1Instruction[]>;
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

/**
 * Decode returnData from native contract runtime.
 * - Empty string => null
 * - JSON object/array => parsed object
 * - Integer string => bigint
 * - Other => raw string
 */
export function decodeContractReturnData(returnData: string | undefined | null): unknown {
  if (returnData === undefined || returnData === null) return undefined;
  const raw = String(returnData);
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // Fall through to string decoding.
    }
  }

  if (/^-?\d+$/.test(trimmed)) {
    try {
      return BigInt(trimmed);
    } catch {
      // Fall through to string decoding.
    }
  }

  return raw;
}

/** Encode arbitrary UTF-8 text as lowercase hex for RPC-safe contract deploys. */
export function encodeUtf8Hex(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

/** Decode lowercase/uppercase hex into UTF-8 text. */
export function decodeUtf8Hex(hex: string): string {
  return Buffer.from(hex, "hex").toString("utf8");
}

/** Build the canonical qtx-v1 contract definition object. */
export function createQtxVmV1Contract(methods: Record<string, QtxVmV1Instruction[]>): QtxVmV1ContractDefinition {
  return {
    vm: "qtx-v1",
    methods,
  };
}

/** Serialize a qtx-v1 contract definition into the JSON payload understood by the protocol. */
export function stringifyQtxVmV1Contract(
  contract: QtxVmV1ContractDefinition | Record<string, QtxVmV1Instruction[]>,
): string {
  const normalized = "vm" in contract ? contract : createQtxVmV1Contract(contract);
  return JSON.stringify(normalized);
}

/** Serialize a qtx-v1 contract and encode it as hex for JSON-RPC submission. */
export function encodeQtxVmV1ContractHex(
  contract: QtxVmV1ContractDefinition | Record<string, QtxVmV1Instruction[]>,
): string {
  return encodeUtf8Hex(stringifyQtxVmV1Contract(contract));
}

// ─── Transaction builders ─────────────────────────────────────────────────────

/**
 * Build and sign a transfer transaction.
 * Sends `amount` QTX from `from` to `to`.
 */
export function buildTransferTx(params: TransferParams): Transaction {
  return sign(
    {
      chainId: params.chainId,
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
      chainId: params.chainId,
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
      chainId: params.chainId,
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
      chainId: params.chainId,
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

/**
 * Build and sign a contract_deploy transaction.
 */
export function buildContractDeployTx(params: ContractDeployParams): Transaction {
  return sign(
    {
      chainId: params.chainId,
      type: "contract_deploy",
      from: params.from,
      nonce: params.nonce,
      timestamp: Date.now(),
      amount: params.amount,
      fee: params.fee ?? 0n,
      signerPublicKey: params.signerPublicKey,
      contractCode: params.contractCode,
      gasLimit: params.gasLimit,
      maxFeePerGas: params.maxFeePerGas ?? 0n,
      value: params.value ?? params.amount,
      ...(params.salt !== undefined ? { salt: params.salt } : {}),
      ...(params.contractAddress !== undefined ? { contractAddress: params.contractAddress } : {}),
    },
    params.privateKey,
  );
}

/**
 * Build and sign a qtx-v1 contract_deploy transaction.
 * Defaults to hex encoding so payload is accepted by strict RPC policy.
 */
export function buildQtxVmV1DeployTx(params: QtxVmV1DeployParams): Transaction {
  const normalized = "vm" in params.contract ? params.contract : createQtxVmV1Contract(params.contract);
  const contractCode = params.encoding === "json"
    ? stringifyQtxVmV1Contract(normalized)
    : encodeQtxVmV1ContractHex(normalized);

  return buildContractDeployTx({
    ...params,
    contractCode,
  });
}

/**
 * Build and sign a contract_call transaction.
 */
export function buildContractCallTx(params: ContractCallParams): Transaction {
  return sign(
    {
      chainId: params.chainId,
      type: "contract_call",
      from: params.from,
      nonce: params.nonce,
      timestamp: Date.now(),
      amount: params.amount,
      fee: params.fee ?? 0n,
      signerPublicKey: params.signerPublicKey,
      contractAddress: params.contractAddress,
      method: params.method,
      args: params.args ?? [],
      gasLimit: params.gasLimit,
      maxFeePerGas: params.maxFeePerGas ?? 0n,
      value: params.value ?? params.amount,
    },
    params.privateKey,
  );
}

/**
 * Build and sign a qtx-v1 contract_call transaction.
 * This is a thin convenience wrapper over buildContractCallTx.
 */
export function buildQtxVmV1CallTx(params: QtxVmV1CallParams): Transaction {
  return buildContractCallTx({
    ...params,
    args: params.args ?? [],
  });
}

/**
 * Convenience helper for read-only qtx-v1 method simulation with decoded returnData.
 */
export async function callQtxVmV1Decoded(
  rpcEndpoint: string,
  params: QtxVmV1CallParams,
): Promise<DecodedContractCallResult> {
  const tx = buildQtxVmV1CallTx(params);
  return callContractDecoded(rpcEndpoint, tx);
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
 * Fetch deployed contract metadata and code.
 */
export async function getCode(rpcEndpoint: string, contractAddress: Address): Promise<ContractCodeResult> {
  return rpcCall<ContractCodeResult>(rpcEndpoint, "qtx_getCode", [contractAddress]);
}

/**
 * Fetch a contract execution receipt by transaction hash.
 */
export async function getReceipt(rpcEndpoint: string, txHash: string): Promise<ContractReceiptResult> {
  return rpcCall<ContractReceiptResult>(rpcEndpoint, "qtx_getReceipt", [txHash]);
}

/**
 * Fetch all contract receipts in a block.
 */
export async function getReceiptsByBlock(rpcEndpoint: string, blockHeight: number): Promise<ContractReceiptResult[]> {
  return rpcCall<ContractReceiptResult[]>(rpcEndpoint, "qtx_getReceiptsByBlock", [blockHeight]);
}

/**
 * Fetch contract events with optional filters.
 */
export async function getEvents(
  rpcEndpoint: string,
  contractAddress: Address,
  fromHeight: number = 0,
  toHeight: number = Number.MAX_SAFE_INTEGER,
  name?: string,
): Promise<ContractEventResult[]> {
  return rpcCall<ContractEventResult[]>(rpcEndpoint, "qtx_getEvents", [contractAddress, fromHeight, toHeight, name]);
}

/**
 * Fetch contract storage. If key is omitted, returns full storage map.
 */
export async function getStorage(
  rpcEndpoint: string,
  contractAddress: Address,
  key?: string,
): Promise<ContractStorageResult> {
  return rpcCall<ContractStorageResult>(rpcEndpoint, "qtx_getStorage", [contractAddress, key]);
}

/**
 * Estimate gas for contract deploy/call transactions.
 */
export async function estimateGas(
  rpcEndpoint: string,
  tx: Transaction,
): Promise<{ gasEstimate: number }> {
  return rpcCall<{ gasEstimate: number }>(rpcEndpoint, "qtx_estimateGas", [serializeTx(tx)]);
}

/**
 * Read-only contract call simulation (no state commit).
 */
export async function callContract(
  rpcEndpoint: string,
  tx: Transaction,
): Promise<{
  success: boolean;
  error?: string;
  contractAddress?: string;
  receipt?: ContractReceiptResult | null;
  storage?: Record<string, string>;
}> {
  return rpcCall(rpcEndpoint, "qtx_call", [serializeTx(tx)]);
}

/**
 * Read-only contract simulation with decoded returnData convenience field.
 */
export async function callContractDecoded(
  rpcEndpoint: string,
  tx: Transaction,
): Promise<DecodedContractCallResult> {
  const result = await callContract(rpcEndpoint, tx);
  return {
    ...result,
    decodedReturnData: decodeContractReturnData(result.receipt?.returnData),
  };
}

/**
 * Fetch contract transactions from committed blocks with optional filtering.
 */
export async function getContractTransactions(
  rpcEndpoint: string,
  contractAddress: Address = "",
  fromHeight: number = 0,
  toHeight: number = Number.MAX_SAFE_INTEGER,
): Promise<Array<Record<string, unknown>>> {
  return rpcCall<Array<Record<string, unknown>>>(
    rpcEndpoint,
    "qtx_getContractTransactions",
    [contractAddress, fromHeight, toHeight],
  );
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
