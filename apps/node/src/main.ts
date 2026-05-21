import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  DEFAULT_PROTOCOL_CONFIG,
  applyBlock,
  createGenesisState,
  runConsensusRound,
  slashValidatorForEquivocation,
  transactionSigningPayload,
  type Transaction,
} from "@quantix/protocol";
import { deriveAddressFromPublicKey, generatePqKeyPair, signPqMessage, verifyPqSignature } from "@quantix/crypto";
import { loadDevnetConfig, type ValidatorConfig } from "./config.js";
import { asRpcError, RpcError, RpcErrorCode } from "./rpc-errors.js";
import { rpcCall } from "./rpc-client.js";
import { loadPersistedNodeData, savePersistedNodeData } from "./storage.js";
import { enqueueValidatedTx, getNextExpectedNonce, hashTx, parseRpcTransactionStrict } from "./tx-policy.js";

interface Proposal {
  height: number;
  parentHash: string;
  proposerId: string;
  txs: Transaction[];
  hash: string;
}

interface Vote {
  proposalHash: string;
  height: number;
  voterId: string;
  signature: string;
}

const defaultConfigPath = resolve(
  fileURLToPath(new URL("../../../testnets/devnet/config.json", import.meta.url)),
);
const configPath = process.env.QTX_CONFIG_PATH ? resolve(process.env.QTX_CONFIG_PATH) : defaultConfigPath;
const devnetConfig = loadDevnetConfig(configPath);
const nodeId = process.env.NODE_ID ?? devnetConfig.validators[0].id;
const defaultDataDir = resolve(
  fileURLToPath(new URL(`../../../testnets/devnet/data/${nodeId}`, import.meta.url)),
);
const dataDir = process.env.QTX_DATA_DIR ? resolve(process.env.QTX_DATA_DIR) : defaultDataDir;
const selfConfig = devnetConfig.validators.find((validator) => validator.id === nodeId);
if (!selfConfig) {
  throw new Error(`NODE_ID '${nodeId}' not found in config`);
}

const keyByValidatorId = new Map<string, ReturnType<typeof generatePqKeyPair>>();
const addressByValidatorId = new Map<string, string>();
const validatorByAddress = new Map<string, ValidatorConfig>();

for (const validator of devnetConfig.validators) {
  const keys = generatePqKeyPair(validator.seedHex);
  keyByValidatorId.set(validator.id, keys);
  const address = deriveAddressFromPublicKey(keys.publicKey);
  addressByValidatorId.set(validator.id, address);
  validatorByAddress.set(address, validator);
}

const selfKeys = keyByValidatorId.get(nodeId) ?? fail(`missing key material for ${nodeId}`);
const selfAddress = addressByValidatorId.get(nodeId) ?? fail(`missing address for ${nodeId}`);
const peerConfigs = devnetConfig.validators.filter((validator) => validator.id !== nodeId);

const state = createGenesisState(
  Object.fromEntries(
    devnetConfig.validators.map((validator) => {
      const address = addressByValidatorId.get(validator.id);
      if (!address) {
        throw new Error(`missing address for ${validator.id}`);
      }

      return [address, BigInt(validator.initialBalance)];
    }),
  ),
);

const mempool: Transaction[] = [];
const blocks: Array<{ height: number; hash: string; txCount: number; committed: boolean }> = [];
const offlineValidators = new Set<string>();
const pendingProposals = new Map<string, Proposal>();
let bootstrapApplied = false;

const verifier = (tx: Transaction, payload: string): true | string => {
  if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
    return "signer address mismatch";
  }

  if (!verifyPqSignature(tx.signerPublicKey, payload, tx.signature)) {
    return "invalid pq signature";
  }

  return true;
};

const blockIntervalMs = Number(process.env.QTX_BLOCK_INTERVAL_MS ?? String(devnetConfig.blockIntervalMs));
const rpcPort = Number(process.env.QTX_RPC_PORT ?? String(selfConfig.rpcPort));

loadStateFromDisk();
applyBootstrapOnce();
seedInitialMempool();

setInterval(() => {
  void produceDistributedBlock();
}, blockIntervalMs);

setInterval(() => {
  void syncFromPeers();
}, blockIntervalMs * 2);

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/rpc") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  try {
    const body = await readBody(req);
    const rpc = JSON.parse(body) as { id?: string | number; method?: string; params?: unknown[] };

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
  console.log(`[${nodeId}] bootstrap complete at height ${state.height}`);
  console.log(`[${nodeId}] RPC listening on http://localhost:${rpcPort}/rpc`);
  console.log(`[${nodeId}] block interval ${blockIntervalMs}ms`);
  logStateSummary();
});

function applyBootstrapOnce(): void {
  if (bootstrapApplied) {
    return;
  }

  if (state.height > 0) {
    bootstrapApplied = true;
    return;
  }

  const bootstrapTxs: Transaction[] = [];
  for (const validator of devnetConfig.validators) {
    const address = addressByValidatorId.get(validator.id);
    const keys = keyByValidatorId.get(validator.id);
    if (!address || !keys) {
      throw new Error(`missing bootstrap material for ${validator.id}`);
    }

    bootstrapTxs.push(
      signTxFor(address, keys.privateKey, {
        type: "stake",
        from: address,
        nonce: 1,
        amount: BigInt(validator.initialStake),
      }),
    );
    bootstrapTxs.push(
      signTxFor(address, keys.privateKey, {
        type: "validator_register",
        from: address,
        nonce: 2,
        amount: 1n,
        validatorId: validator.id,
      }),
    );
  }

  const bootstrapResult = applyBlock(state, bootstrapTxs, DEFAULT_PROTOCOL_CONFIG, { verifySignature: verifier });
  bootstrapApplied = true;
  if (bootstrapResult.rejected.length > 0) {
    throw new Error(`bootstrap failed with ${bootstrapResult.rejected.length} rejected transactions`);
  }

  persistNodeData();
}

function seedInitialMempool(): void {
  if (nodeId !== devnetConfig.validators[0].id) {
    return;
  }

  const toValidator = devnetConfig.validators[1];
  const toAddress = addressByValidatorId.get(toValidator.id);
  if (!toAddress) {
    return;
  }

  enqueueSignedTx(
    signTx({
      type: "transfer",
      from: selfAddress,
      to: toAddress,
      nonce: 3,
      amount: 25n,
    }),
  );
}

function signTx(input: {
  type: Transaction["type"];
  from: string;
  nonce: number;
  amount: bigint;
  to?: string;
  validatorId?: string;
}): Transaction {
  return signTxFor(input.from, selfKeys.privateKey, input);
}

function signTxFor(
  from: string,
  privateKey: string,
  input: {
    type: Transaction["type"];
    from: string;
    nonce: number;
    amount: bigint;
    to?: string;
    validatorId?: string;
  },
): Transaction {
  const signer = keyByValidatorId.get(validatorByAddress.get(from)?.id ?? nodeId);
  const signerPublicKey = signer?.publicKey ?? selfKeys.publicKey;
  const txWithoutSig: Transaction = {
    ...input,
    signerPublicKey,
    signature: "",
  };

  const payload = transactionSigningPayload(txWithoutSig);
  const signature = signPqMessage(privateKey, payload);
  return {
    ...txWithoutSig,
    signature,
  };
}

function enqueueSignedTx(tx: Transaction): { txHash: string } {
  return enqueueValidatedTx(state, mempool, tx, verifier);
}

function getActiveValidatorIds(): string[] {
  return Object.values(state.validators)
    .filter((validator) => validator.active && !validator.slashed)
    .map((validator) => validator.id)
    .sort();
}

function isCurrentProposer(): boolean {
  const active = getActiveValidatorIds();
  if (active.length === 0) {
    return false;
  }
  const proposer = active[state.height % active.length];
  return proposer === nodeId;
}

async function produceDistributedBlock(): Promise<{
  committed: boolean;
  height: number;
  txCount: number;
  proposer: string;
  reason?: string;
}> {
  if (!isCurrentProposer()) {
    return {
      committed: false,
      height: state.height,
      txCount: 0,
      proposer: nodeId,
      reason: "not proposer for current height",
    };
  }

  const batch = mempool.splice(0, 100);
  const proposal: Proposal = {
    height: state.height + 1,
    parentHash: state.lastBlockHash,
    proposerId: nodeId,
    txs: batch,
    hash: hashProposal(state.height + 1, state.lastBlockHash, nodeId, batch),
  };

  pendingProposals.set(proposal.hash, proposal);
  const selfVote = buildVote(proposal.hash, proposal.height, nodeId, selfKeys.privateKey);

  const votes: Vote[] = [selfVote];
  const unavailable: string[] = [];

  await Promise.all(
    peerConfigs.map(async (peer) => {
      try {
        const peerVote = await rpcCall<Vote | null>(
          `http://127.0.0.1:${peer.rpcPort}/rpc`,
          "qtx_consensusPrepare",
          [proposal],
        );
        if (peerVote) {
          votes.push(peerVote);
        } else {
          unavailable.push(peer.id);
        }
      } catch {
        unavailable.push(peer.id);
      }
    }),
  );

  const round = runConsensusRound(state, batch, DEFAULT_PROTOCOL_CONFIG, {
    verifySignature: verifier,
    unavailableValidatorIds: unavailable,
    maxMissedBlocksBeforeSlash: 3,
  });

  if (!round.committed) {
    mempool.unshift(...batch);
    pendingProposals.delete(proposal.hash);
    return {
      committed: false,
      height: state.height,
      txCount: 0,
      proposer: nodeId,
      reason: round.reason ?? "quorum not reached",
    };
  }

  blocks.push({
    height: state.height,
    hash: state.lastBlockHash,
    txCount: round.applyResult?.accepted.length ?? 0,
    committed: true,
  });
  persistNodeData();

  await Promise.all(
    peerConfigs.map(async (peer) => {
      try {
        await rpcCall(
          `http://127.0.0.1:${peer.rpcPort}/rpc`,
          "qtx_consensusCommit",
          [proposal.hash, votes],
        );
      } catch {
        // Peer will recover via head sync path.
      }
    }),
  );

  pendingProposals.delete(proposal.hash);
  return {
    committed: true,
    height: state.height,
    txCount: round.applyResult?.accepted.length ?? 0,
    proposer: nodeId,
  };
}

interface RpcStateSnapshot {
  nodeId: string;
  height: number;
  hash: string;
  blocks?: Array<{ height: number; hash: string; txCount: number; committed: boolean }>;
  accounts: Record<string, { balance: string; nonce: number; staked: string }>;
  validators: Record<
    string,
    {
      id: string;
      owner: string;
      stake: string;
      active: boolean;
      missedBlocks: number;
      slashed: boolean;
    }
  >;
  pendingUnstakes: Array<{ owner: string; amount: string; unlockAt: number }>;
  offlineValidators: string[];
}

interface PersistedNodeData {
  version: number;
  nodeId: string;
  updatedAt: string;
  state: RpcStateSnapshot;
}

async function syncFromPeers(): Promise<void> {
  const heads = await Promise.all(
    peerConfigs.map(async (peer) => {
      try {
        const latest = await rpcCall<{ height: number; hash: string }>(
          `http://127.0.0.1:${peer.rpcPort}/rpc`,
          "qtx_getLatestBlock",
          [],
        );
        return {
          peer,
          latest,
        };
      } catch {
        return null;
      }
    }),
  );

  const highest = heads
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.latest.height - a.latest.height)[0];

  if (!highest || highest.latest.height <= state.height) {
    return;
  }

  const snapshot = await rpcCall<RpcStateSnapshot>(
    `http://127.0.0.1:${highest.peer.rpcPort}/rpc`,
    "qtx_getState",
    [],
  );

  importStateSnapshot(snapshot);
  persistNodeData();
}

function importStateSnapshot(snapshot: RpcStateSnapshot): void {
  state.height = snapshot.height;
  state.lastBlockHash = snapshot.hash;
  state.accounts = Object.fromEntries(
    Object.entries(snapshot.accounts).map(([address, account]) => [
      address,
      {
        balance: BigInt(account.balance),
        nonce: account.nonce,
        staked: BigInt(account.staked),
      },
    ]),
  );

  state.validators = Object.fromEntries(
    Object.entries(snapshot.validators).map(([id, validator]) => [
      id,
      {
        ...validator,
        stake: BigInt(validator.stake),
      },
    ]),
  );

  state.pendingUnstakes = snapshot.pendingUnstakes.map((entry) => ({
    owner: entry.owner,
    amount: BigInt(entry.amount),
    unlockAt: entry.unlockAt,
  }));

  blocks.length = 0;
  for (const block of snapshot.blocks ?? []) {
    blocks.push(block);
  }

  offlineValidators.clear();
  for (const validatorId of snapshot.offlineValidators) {
    offlineValidators.add(validatorId);
  }
}

function buildVote(proposalHash: string, height: number, voterId: string, privateKey: string): Vote {
  const payload = `${proposalHash}:${height}:${voterId}`;
  return {
    proposalHash,
    height,
    voterId,
    signature: signPqMessage(privateKey, payload),
  };
}

function verifyVote(vote: Vote): boolean {
  const key = keyByValidatorId.get(vote.voterId);
  if (!key) {
    return false;
  }
  const payload = `${vote.proposalHash}:${vote.height}:${vote.voterId}`;
  return verifyPqSignature(key.publicKey, payload, vote.signature);
}

function hashProposal(height: number, parentHash: string, proposerId: string, txs: Transaction[]): string {
  return createHash("sha256")
    .update(
      `${height}:${parentHash}:${proposerId}:${txs
        .map((tx) => transactionSigningPayload(tx))
        .join("|")}`,
    )
    .digest("hex");
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
    case "qtx_getBlockHead":
    case "qtx_getLatestBlock": {
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
      return mempool.map((tx) => ({ hash: hashTx(tx), from: tx.from, nonce: tx.nonce, type: tx.type }));
    }
    case "qtx_submitTransaction": {
      const tx = parseRpcTransactionStrict(params[0]);
      return enqueueSignedTx(tx);
    }
    case "qtx_consensusPrepare": {
      const proposal = params[0] as Proposal;
      if (!proposal || proposal.height !== state.height + 1 || proposal.parentHash !== state.lastBlockHash) {
        return null;
      }

      const expected = hashProposal(proposal.height, proposal.parentHash, proposal.proposerId, proposal.txs);
      if (proposal.hash !== expected) {
        return null;
      }

      pendingProposals.set(proposal.hash, proposal);
      return buildVote(proposal.hash, proposal.height, nodeId, selfKeys.privateKey);
    }
    case "qtx_consensusCommit": {
      const proposalHash = String(params[0] ?? "");
      const votes = (params[1] as Vote[]) ?? [];
      const proposal = pendingProposals.get(proposalHash);
      if (!proposal) {
        return { committed: false, reason: "unknown proposal" };
      }

      const validVotes = votes.filter((vote) => vote.proposalHash === proposalHash && verifyVote(vote));
      const activeCount = getActiveValidatorIds().length;
      const quorum = Math.floor((activeCount * 2) / 3) + 1;
      if (validVotes.length < quorum) {
        return { committed: false, reason: "insufficient commit votes" };
      }

      const applyResult = applyBlock(state, proposal.txs, DEFAULT_PROTOCOL_CONFIG, { verifySignature: verifier });
      blocks.push({
        height: state.height,
        hash: state.lastBlockHash,
        txCount: applyResult.accepted.length,
        committed: true,
      });
      persistNodeData();
      pendingProposals.delete(proposalHash);
      return { committed: true, height: state.height, accepted: applyResult.accepted.length };
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

      persistNodeData();

      return { validatorId, offline };
    }
    case "qtx_slashEquivocation": {
      const validatorId = String(params[0] ?? "");
      const slashed = slashValidatorForEquivocation(state, validatorId, 10);
      if (slashed) {
        persistNodeData();
      }
      return { validatorId, slashed };
    }
    case "qtx_produceBlock": {
      return produceDistributedBlock();
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

      const nextNonce = getNextExpectedNonce(state, mempool, selfAddress);
      const tx = signTx({
        type: "transfer",
        from: selfAddress,
        to,
        nonce: nextNonce,
        amount,
      });
      return enqueueSignedTx(tx);
    }
    case "qtx_getState": {
      return buildStateSnapshot();
    }
    default:
      throw new RpcError(RpcErrorCode.METHOD_NOT_FOUND, `unsupported method: ${method}`, { method });
  }
}

function logStateSummary(): void {
  console.log(`[${nodeId}] state summary`, {
    height: state.height,
    hash: state.lastBlockHash,
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

function fail(message: string): never {
  throw new Error(message);
}

function loadStateFromDisk(): void {
  const persisted = loadPersistedNodeData<PersistedNodeData>(dataDir);
  if (!persisted || persisted.nodeId !== nodeId) {
    return;
  }

  importStateSnapshot(persisted.state);
  bootstrapApplied = state.height > 0;
}

function persistNodeData(): void {
  const snapshot = buildStateSnapshot();

  savePersistedNodeData<PersistedNodeData>(dataDir, {
    version: 1,
    nodeId,
    updatedAt: new Date().toISOString(),
    state: snapshot,
  });
}

function buildStateSnapshot(): RpcStateSnapshot {
  return {
    nodeId,
    height: state.height,
    hash: state.lastBlockHash,
    blocks: blocks.map((block) => ({ ...block })),
    accounts: Object.fromEntries(
      Object.entries(state.accounts).map(([address, account]) => [
        address,
        {
          balance: account.balance.toString(),
          nonce: account.nonce,
          staked: account.staked.toString(),
        },
      ]),
    ),
    validators: Object.fromEntries(
      Object.entries(state.validators).map(([validatorId, validator]) => [
        validatorId,
        {
          id: validator.id,
          owner: validator.owner,
          stake: validator.stake.toString(),
          active: validator.active,
          missedBlocks: validator.missedBlocks,
          slashed: validator.slashed,
        },
      ]),
    ),
    pendingUnstakes: state.pendingUnstakes.map((entry) => ({
      owner: entry.owner,
      amount: entry.amount.toString(),
      unlockAt: entry.unlockAt,
    })),
    offlineValidators: [...offlineValidators],
  };
}
