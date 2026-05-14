import { createServer } from "node:http";
import {
  DEFAULT_PROTOCOL_CONFIG,
  applyBlock,
  createGenesisState,
  runConsensusRound,
  slashValidatorForEquivocation,
  transactionSigningPayload,
  type Transaction,
} from "@quantix/protocol";
import {
  deriveAddressFromPublicKey,
  generatePqKeyPair,
  signPqMessage,
  verifyPqSignature,
} from "@quantix/crypto";
import { asRpcError, RpcError, RpcErrorCode } from "./rpc-errors.js";
import { enqueueValidatedTx, getNextExpectedNonce, hashTx, parseRpcTransactionStrict } from "./tx-policy.js";

const aliceKeys = generatePqKeyPair();
const bobKeys = generatePqKeyPair();
const carolKeys = generatePqKeyPair();

const alice = deriveAddressFromPublicKey(aliceKeys.publicKey);
const bob = deriveAddressFromPublicKey(bobKeys.publicKey);
const carol = deriveAddressFromPublicKey(carolKeys.publicKey);

const state = createGenesisState({
  [alice]: 1_000n,
  [bob]: 600n,
  [carol]: 600n,
});

const mempool: Transaction[] = [];
const blocks: Array<{
  height: number;
  hash: string;
  txCount: number;
  committed: boolean;
}> = [];
const offlineValidators = new Set<string>();

const keyByAddress = new Map([
  [alice, aliceKeys],
  [bob, bobKeys],
  [carol, carolKeys],
]);

const verifier = (tx: Transaction, payload: string): true | string => {
  if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
    return "signer address mismatch";
  }

  if (!verifyPqSignature(tx.signerPublicKey, payload, tx.signature)) {
    return "invalid pq signature";
  }

  return true;
};

const bootstrapBlock: Transaction[] = [
  signTx({ type: "stake", from: alice, nonce: 1, amount: 100n }),
  signTx({ type: "validator_register", from: alice, nonce: 2, amount: 1n, validatorId: "validator-alice" }),
  signTx({ type: "stake", from: bob, nonce: 1, amount: 100n }),
  signTx({ type: "validator_register", from: bob, nonce: 2, amount: 1n, validatorId: "validator-bob" }),
  signTx({ type: "stake", from: carol, nonce: 1, amount: 100n }),
  signTx({ type: "validator_register", from: carol, nonce: 2, amount: 1n, validatorId: "validator-carol" }),
];

const bootstrapResult = applyBlock(state, bootstrapBlock, DEFAULT_PROTOCOL_CONFIG, { verifySignature: verifier });

enqueueSignedTx(
  signTx({
    type: "transfer",
    from: alice,
    to: bob,
    nonce: 3,
    amount: 25n,
  }),
);

const blockIntervalMs = Number(process.env.QTX_BLOCK_INTERVAL_MS ?? "4000");
const rpcPort = Number(process.env.QTX_RPC_PORT ?? "7331");

setInterval(() => {
  produceBlock();
}, blockIntervalMs);

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/rpc") {
    sendJson(res, 404, {
      error: "not found",
    });
    return;
  }

  try {
    const body = await readBody(req);
    const rpc = JSON.parse(body) as {
      id?: string | number;
      method?: string;
      params?: unknown[];
    };

    if (!rpc || typeof rpc !== "object") {
      throw new RpcError(RpcErrorCode.INVALID_REQUEST, "invalid JSON-RPC request");
    }

    if (rpc.method !== undefined && typeof rpc.method !== "string") {
      throw new RpcError(RpcErrorCode.INVALID_REQUEST, "field 'method' must be a string");
    }

    if (rpc.params !== undefined && !Array.isArray(rpc.params)) {
      throw new RpcError(RpcErrorCode.INVALID_PARAMS, "field 'params' must be an array");
    }

    const result = await handleRpcRequest(rpc.method ?? "", rpc.params ?? []);
    sendJson(res, 200, {
      jsonrpc: "2.0",
      id: rpc.id ?? null,
      result,
    });
  } catch (error) {
    const rpcError = asRpcError(error);
    sendJson(res, 200, {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: rpcError.code,
        message: rpcError.message,
        data: rpcError.data,
      },
    });
  }
});

server.listen(rpcPort, () => {
  console.log("Bootstrap block applied");
  console.log(`Accepted txs: ${bootstrapResult.accepted.length}`);
  console.log(`Rejected txs: ${bootstrapResult.rejected.length}`);
  console.log(`RPC listening on http://localhost:${rpcPort}/rpc`);
  console.log(`Block interval: ${blockIntervalMs}ms`);
  logStateSummary();
});

function signTx(input: {
  type: Transaction["type"];
  from: string;
  nonce: number;
  amount: bigint;
  to?: string;
  validatorId?: string;
}): Transaction {
  const keys = keyByAddress.get(input.from);
  if (!keys) {
    throw new Error(`no keys found for address ${input.from}`);
  }

  const txWithoutSig: Transaction = {
    ...input,
    signerPublicKey: keys.publicKey,
    signature: "",
  };

  const payload = transactionSigningPayload(txWithoutSig);
  const signature = signPqMessage(keys.privateKey, payload);

  return {
    ...txWithoutSig,
    signature,
  };
}

function enqueueSignedTx(tx: Transaction): { txHash: string } {
  return enqueueValidatedTx(state, mempool, tx, verifier);
}

function produceBlock(): {
  committed: boolean;
  height: number;
  txCount: number;
  proposer: string;
  slashedValidators: string[];
  reason?: string;
} {
  const batch = mempool.splice(0, 100);
  const round = runConsensusRound(state, batch, DEFAULT_PROTOCOL_CONFIG, {
    verifySignature: verifier,
    unavailableValidatorIds: [...offlineValidators],
    maxMissedBlocksBeforeSlash: 3,
  });

  blocks.push({
    height: state.height,
    hash: state.lastBlockHash,
    txCount: round.applyResult?.accepted.length ?? 0,
    committed: round.committed,
  });

  if (round.reason) {
    // Failed rounds return txs to mempool for retry.
    mempool.unshift(...batch);
  }

  return {
    committed: round.committed,
    height: state.height,
    txCount: round.applyResult?.accepted.length ?? 0,
    proposer: round.proposerId,
    slashedValidators: round.slashedValidators,
    reason: round.reason,
  };
}

async function handleRpcRequest(method: string, params: unknown[]): Promise<unknown> {
  switch (method) {
    case "qtx_getBalance": {
      const address = String(params[0] ?? "");
      const account = state.accounts[address];
      return {
        address,
        balance: account?.balance.toString() ?? "0",
        nonce: account?.nonce ?? 0,
        staked: account?.staked.toString() ?? "0",
      };
    }
    case "qtx_getBlockHead": {
      return {
        height: state.height,
        hash: state.lastBlockHash,
      };
    }
    case "qtx_getValidators": {
      return Object.values(state.validators).map((validator) => ({
        ...validator,
        stake: validator.stake.toString(),
      }));
    }
    case "qtx_getMempool": {
      return mempool.map((tx) => ({
        hash: hashTx(tx),
        from: tx.from,
        nonce: tx.nonce,
        type: tx.type,
      }));
    }
    case "qtx_submitTransaction": {
      const tx = parseRpcTransactionStrict(params[0]);
      return enqueueSignedTx(tx);
    }
    case "qtx_markValidatorOffline": {
      const validatorId = String(params[0] ?? "");
      const offline = Boolean(params[1]);
      if (!state.validators[validatorId]) {
        throw new RpcError(RpcErrorCode.NOT_FOUND, "validator not found", {
          category: "lookup",
          validatorId,
        });
      }

      if (offline) {
        offlineValidators.add(validatorId);
      } else {
        offlineValidators.delete(validatorId);
      }

      return {
        validatorId,
        offline,
      };
    }
    case "qtx_slashEquivocation": {
      const validatorId = String(params[0] ?? "");
      const slashed = slashValidatorForEquivocation(state, validatorId, 10);
      return {
        validatorId,
        slashed,
      };
    }
    case "qtx_produceBlock": {
      return produceBlock();
    }
    case "qtx_seedTransfer": {
      const to = String(params[0] ?? "");
      const amount = BigInt(String(params[1] ?? "0"));
      if (!to.startsWith("qtx1")) {
        throw new RpcError(RpcErrorCode.INVALID_PARAMS, "seed transfer requires a valid qtx recipient", {
          category: "schema",
          field: "to",
        });
      }
      if (amount <= 0n) {
        throw new RpcError(RpcErrorCode.INVALID_PARAMS, "seed transfer amount must be > 0", {
          category: "schema",
          field: "amount",
        });
      }
      const nextNonce = getNextExpectedNonce(state, mempool, alice);
      const tx = signTx({
        type: "transfer",
        from: alice,
        to,
        nonce: nextNonce,
        amount,
      });
      return enqueueSignedTx(tx);
    }
    case "qtx_getState": {
      return serializeForJson({
        height: state.height,
        hash: state.lastBlockHash,
        accounts: state.accounts,
        validators: state.validators,
        pendingUnstakes: state.pendingUnstakes,
        offlineValidators: [...offlineValidators],
      });
    }
    default:
      throw new RpcError(RpcErrorCode.METHOD_NOT_FOUND, `unsupported method: ${method}`, {
        method,
      });
  }
}

function logStateSummary(): void {
  console.log("State summary:", {
    height: state.height,
    hash: state.lastBlockHash,
    balances: {
      [alice]: state.accounts[alice],
      [bob]: state.accounts[bob],
      [carol]: state.accounts[carol],
    },
    validators: Object.keys(state.validators),
  });
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(serializeForJson(payload)));
}

function serializeForJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, current) => (typeof current === "bigint" ? current.toString() : current)),
  ) as T;
}
