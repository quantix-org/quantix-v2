import { createHash } from "node:crypto";
import { transactionSigningPayload, type ProtocolState, type Transaction } from "@quantix/protocol";
import { RpcError, RpcErrorCode } from "./rpc-errors.js";

type VerifySignature = (tx: Transaction, payload: string) => true | string;

const ACCOUNT_ADDRESS_PREFIX = "qtx1";
const CONTRACT_ADDRESS_PREFIX = "qtxContract";

const TX_TYPES = new Set<Transaction["type"]>([
  "transfer",
  "stake",
  "unstake",
  "validator_register",
  "validator_unregister",
  "contract_deploy",
  "contract_call",
]);

export function parseRpcTransactionStrict(input: unknown): Transaction {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, "invalid transaction payload: expected object", {
      category: "schema",
    });
  }

  const candidate = input as Record<string, unknown>;

  const type = mustBeTxType(candidate.type);
  const chainId = mustBeNonEmptyString(candidate.chainId, "chainId");
  const from = mustBeAccountAddress(candidate.from, "from");
  const nonce = mustBeNonce(candidate.nonce);
  const timestamp =
    typeof candidate.timestamp === "number" && candidate.timestamp > 0
      ? candidate.timestamp
      : Date.now(); // fallback for older clients
  const amount =
    type === "contract_deploy" || type === "contract_call"
      ? mustBeNonNegativeAmount(candidate.amount)
      : mustBePositiveAmount(candidate.amount);
  const fee = mustBeNonNegativeAmount(candidate.fee);
  const signerPublicKey = mustBeHex(candidate.signerPublicKey, "signerPublicKey");
  const signature = mustBeHex(candidate.signature, "signature");

  const tx: Transaction = {
    type,
    chainId,
    from,
    nonce,
    timestamp,
    amount,
    fee,
    signerPublicKey,
    signature,
  };

  if (type === "transfer") {
    tx.to = mustBeAccountAddress(candidate.to, "to");
  } else if (candidate.to !== undefined) {
    throw new Error("field 'to' is only allowed for transfer transactions");
  }

  if (type === "validator_register") {
    tx.validatorId = mustBeNonEmptyString(candidate.validatorId, "validatorId");
  } else if (candidate.validatorId !== undefined) {
    throw new Error("field 'validatorId' is only allowed for validator_register transactions");
  }

  if (type === "contract_deploy") {
    tx.contractCode = mustBeHex(candidate.contractCode, "contractCode");
    tx.gasLimit = mustBePositiveSafeInteger(candidate.gasLimit, "gasLimit");
    tx.maxFeePerGas = mustBeNonNegativeAmount(candidate.maxFeePerGas ?? "0");
    tx.value = mustBeNonNegativeAmount(candidate.value ?? "0");
    if (candidate.salt !== undefined) {
      tx.salt = mustBeNonEmptyString(candidate.salt, "salt");
    }
  } else if (candidate.contractCode !== undefined || candidate.salt !== undefined) {
    throw new Error("field 'contractCode' and 'salt' are only allowed for contract_deploy transactions");
  }

  if (type === "contract_call") {
    tx.contractAddress = mustBeContractAddress(candidate.contractAddress, "contractAddress");
    tx.method = mustBeNonEmptyString(candidate.method, "method");
    tx.args = mustBeArray(candidate.args ?? [], "args");
    tx.gasLimit = mustBePositiveSafeInteger(candidate.gasLimit, "gasLimit");
    tx.maxFeePerGas = mustBeNonNegativeAmount(candidate.maxFeePerGas ?? "0");
    tx.value = mustBeNonNegativeAmount(candidate.value ?? "0");
  } else if (candidate.contractAddress !== undefined || candidate.method !== undefined || candidate.args !== undefined) {
    throw new Error("field 'contractAddress', 'method', and 'args' are only allowed for contract_call transactions");
  }

  return tx;
}

export function getNextExpectedNonce(
  state: ProtocolState,
  mempool: Transaction[],
  address: string,
): number {
  const chainNonce = state.accounts[address]?.nonce ?? 0;
  const pendingForAddress = mempool.filter((tx) => tx.from === address).length;
  return chainNonce + pendingForAddress + 1;
}

export function enqueueValidatedTx(
  state: ProtocolState,
  mempool: Transaction[],
  tx: Transaction,
  verifySignature: VerifySignature,
  expectedChainId: string,
): { txHash: string } {
  const payload = transactionSigningPayload(tx);
  const verifyResult = verifySignature(tx, payload);
  if (tx.chainId !== expectedChainId) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, `transaction rejected: chainId '${tx.chainId}' does not match network '${expectedChainId}'`, {
      category: "chainId",
      from: tx.from,
      nonce: tx.nonce,
    });
  }
  if (verifyResult !== true) {
    throw new RpcError(RpcErrorCode.SIGNATURE_INVALID, `transaction rejected: ${verifyResult}`, {
      category: "signature",
      from: tx.from,
      nonce: tx.nonce,
    });
  }

  const chainNonce = state.accounts[tx.from]?.nonce ?? 0;
  if (tx.nonce <= chainNonce) {
    throw new RpcError(RpcErrorCode.NONCE_STALE, `transaction rejected: nonce ${tx.nonce} is stale (chain nonce ${chainNonce})`, {
      category: "nonce",
      nonce: tx.nonce,
      chainNonce,
    });
  }

  if (mempool.some((pending) => pending.from === tx.from && pending.nonce === tx.nonce)) {
    throw new RpcError(
      RpcErrorCode.NONCE_CONFLICT,
      `transaction rejected: conflicting nonce ${tx.nonce} already in mempool for ${tx.from}`,
      {
        category: "nonce",
        nonce: tx.nonce,
        from: tx.from,
      },
    );
  }

  const nextExpected = getNextExpectedNonce(state, mempool, tx.from);
  if (tx.nonce !== nextExpected) {
    throw new RpcError(
      RpcErrorCode.NONCE_SEQUENCE,
      `transaction rejected: nonce ${tx.nonce} is out of sequence (expected ${nextExpected})`,
      {
        category: "nonce",
        nonce: tx.nonce,
        expectedNonce: nextExpected,
      },
    );
  }

  mempool.push(tx);
  // Sort: higher fee first; same-sender txs stay in nonce order
  mempool.sort((a, b) => {
    if (a.from === b.from) return a.nonce - b.nonce;
    return b.fee > a.fee ? 1 : b.fee < a.fee ? -1 : 0;
  });
  return {
    txHash: hashTx(tx),
  };
}

export function hashTx(tx: Transaction): string {
  return createHash("sha256").update(transactionSigningPayload(tx)).digest("hex");
}

function mustBeTxType(value: unknown): Transaction["type"] {
  if (typeof value !== "string" || !TX_TYPES.has(value as Transaction["type"])) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, "field 'type' must be one of transfer|stake|unstake|validator_register|validator_unregister|contract_deploy|contract_call", {
      category: "schema",
      field: "type",
    });
  }
  return value as Transaction["type"];
}

function mustBeAnyAddress(value: unknown, field: string): string {
  const raw = mustBeNonEmptyString(value, field);
  if (!raw.startsWith(ACCOUNT_ADDRESS_PREFIX) && !raw.startsWith(CONTRACT_ADDRESS_PREFIX)) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, `field '${field}' must be a qtx address`, {
      category: "schema",
      field,
    });
  }
  return raw;
}

function mustBeAccountAddress(value: unknown, field: string): string {
  const raw = mustBeAnyAddress(value, field);
  if (!raw.startsWith(ACCOUNT_ADDRESS_PREFIX)) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, `field '${field}' must be an account address (${ACCOUNT_ADDRESS_PREFIX}...)`, {
      category: "schema",
      field,
    });
  }
  return raw;
}

function mustBeContractAddress(value: unknown, field: string): string {
  const raw = mustBeAnyAddress(value, field);
  if (!raw.startsWith(CONTRACT_ADDRESS_PREFIX)) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, `field '${field}' must be a contract address (${CONTRACT_ADDRESS_PREFIX}...)`, {
      category: "schema",
      field,
    });
  }
  return raw;
}

function mustBeNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, `field '${field}' must be a non-empty string`, {
      category: "schema",
      field,
    });
  }
  return value;
}

function mustBeNonce(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, "field 'nonce' must be a positive safe integer", {
      category: "schema",
      field: "nonce",
    });
  }
  return value;
}

function mustBePositiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, `field '${field}' must be a positive safe integer`, {
      category: "schema",
      field,
    });
  }
  return value;
}

function mustBeArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, `field '${field}' must be an array`, {
      category: "schema",
      field,
    });
  }
  return value;
}

function mustBePositiveAmount(value: unknown): bigint {
  const parsed = parseBigIntLike(value, "amount");
  if (parsed <= 0n) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, "field 'amount' must be > 0", {
      category: "schema",
      field: "amount",
    });
  }
  return parsed;
}

function mustBeNonNegativeAmount(value: unknown): bigint {
  const parsed = parseBigIntLike(value, "fee");
  if (parsed < 0n) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, "field 'fee' must be >= 0", {
      category: "schema",
      field: "fee",
    });
  }
  return parsed;
}

function parseBigIntLike(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RpcError(RpcErrorCode.INVALID_PARAMS, `field '${field}' must be an integer`, {
        category: "schema",
        field,
      });
    }
    return BigInt(value);
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new RpcError(RpcErrorCode.INVALID_PARAMS, `field '${field}' must be an integer-like string, number, or bigint`, {
    category: "schema",
    field,
  });
}

function mustBeHex(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new RpcError(RpcErrorCode.INVALID_PARAMS, `field '${field}' must be a non-empty even-length hex string`, {
      category: "schema",
      field,
    });
  }
  return value.toLowerCase();
}
