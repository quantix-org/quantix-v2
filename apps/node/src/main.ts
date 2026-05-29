import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  applyBlock,
  createGenesisState,
  runConsensusRound,
  slashValidatorForEquivocation,
  transactionSigningPayload,
  type ProtocolConfig,
  type Transaction,
} from "@quantix/protocol";
import { deriveAddressFromPublicKey, generatePqKeyPair, signPqMessage, verifyPqSignature } from "@quantix/crypto";
import { loadDevnetConfig, isSeedNodeConfig, type AnyNodeConfig, type ValidatorConfig } from "./config.js";
import { loadGenesisFile } from "./genesis.js";
import { asRpcError, RpcError, RpcErrorCode } from "./rpc-errors.js";
import { rpcCall } from "./rpc-client.js";
import { NodeStore, type NodeSnapshot, type StoredBlock, type StoredTx } from "./storage.js";
import { enqueueValidatedTx, getNextExpectedNonce, hashTx, parseRpcTransactionStrict } from "./tx-policy.js";

interface Proposal {
  height: number;
  parentHash: string;
  proposerId: string;
  txs: Transaction[];
  hash: string;
  timestamp: number;
}

interface Vote {
  proposalHash: string;
  height: number;
  /** On-chain address of the voter (= derived from signerPublicKey). */
  voterId: string;
  /** ML-DSA-87 public key of the voter — embedded so any node can verify without a pre-shared key map. */
  signerPublicKey: string;
  signature: string;
}

const defaultConfigPath = resolve(
  fileURLToPath(new URL("../../../testnets/devnet/config.json", import.meta.url)),
);
const configPath = process.env.QTX_CONFIG_PATH ? resolve(process.env.QTX_CONFIG_PATH) : defaultConfigPath;
const devnetConfig = loadDevnetConfig(configPath);

const defaultGenesisPath = resolve(
  fileURLToPath(new URL("../../../testnets/devnet/genesis.json", import.meta.url)),
);
const genesisPath = process.env.QTX_GENESIS_PATH ? resolve(process.env.QTX_GENESIS_PATH) : defaultGenesisPath;
const genesis = loadGenesisFile(genesisPath);

const protocolConfig: ProtocolConfig = {
  chainId: genesis.chain.chainId,
  minValidatorStake: BigInt(genesis.protocolParams.minValidatorStake),
  unstakeCooldownBlocks: genesis.protocolParams.unstakeCooldownBlocks,
  baseFee: BigInt(genesis.protocolParams.baseFee),
  epochLength: genesis.protocolParams.epochLength ?? 0,
  maxActiveValidators: genesis.protocolParams.maxActiveValidators ?? 0,
};
const nodeId = process.env.NODE_ID ?? devnetConfig.seedNode.id;
const defaultDataDir = resolve(
  fileURLToPath(new URL(`../../../testnets/devnet/data/${nodeId}`, import.meta.url)),
);
const dataDir = process.env.QTX_DATA_DIR ? resolve(process.env.QTX_DATA_DIR) : defaultDataDir;
const store = new NodeStore(dataDir);

// ── Peer reference type (minimal — only id + rpcPort needed for RPC calls) ──
interface PeerRef {
  id: string;
  rpcPort: number;
}

// ── Build key maps for all known config-based nodes ──────────────────────────
const allNodeConfigs: AnyNodeConfig[] = [devnetConfig.seedNode, ...devnetConfig.validators];
const keyByValidatorId = new Map<string, ReturnType<typeof generatePqKeyPair>>();
const addressByValidatorId = new Map<string, string>();
const validatorByAddress = new Map<string, AnyNodeConfig>();

for (const node of allNodeConfigs) {
  const keys = generatePqKeyPair(node.seedHex);
  keyByValidatorId.set(node.id, keys);
  const address = deriveAddressFromPublicKey(keys.publicKey);
  addressByValidatorId.set(node.id, address);
  validatorByAddress.set(address, node);
}

// ── Self identity ─────────────────────────────────────────────────────────────
// Mode A: node is listed in config.json (seednode or known validator)
// Mode B: node is external — only QTX_SEED_HEX is provided (permissionless join)
const externalSeedHex = process.env.QTX_SEED_HEX;
const selfConfig = externalSeedHex ? undefined : allNodeConfigs.find((n) => n.id === nodeId);

if (!externalSeedHex && !selfConfig) {
  throw new Error(
    `NODE_ID '${nodeId}' not found in config. ` +
    `To run as an external validator, set QTX_SEED_HEX instead.`,
  );
}

const selfKeys = externalSeedHex
  ? generatePqKeyPair(externalSeedHex)
  : (keyByValidatorId.get(nodeId) ?? fail(`missing key material for ${nodeId}`));
const selfAddress = deriveAddressFromPublicKey(selfKeys.publicKey);
const isSeedNode = selfConfig !== undefined && isSeedNodeConfig(selfConfig);

// ── Peer list ─────────────────────────────────────────────────────────────────
// External validators connect to the bootstrap nodes from genesis (not config.json).
// Config-based nodes connect to all other config-based nodes.
const peerConfigs: PeerRef[] = externalSeedHex
  ? genesis.network.peerDiscovery.bootstrapNodes
      .filter((n) => n.id !== nodeId)
      .map((n) => ({ id: n.id, rpcPort: 0 }))
  : allNodeConfigs.filter((n) => n.id !== nodeId).map((n) => ({ id: n.id, rpcPort: n.rpcPort }));

const peerEndpointById = new Map<string, string>(
  genesis.network.peerDiscovery.bootstrapNodes.map((node) => [node.id, node.rpcEndpoint]),
);

const state = createGenesisState(
  Object.fromEntries([
    // Fund config-based nodes (seednode + known validators) from config.json initialBalance.
    // External validators are NOT funded here — they receive QTX via transfer transactions.
    ...allNodeConfigs.map((node) => {
      const address = addressByValidatorId.get(node.id);
      if (!address) {
        throw new Error(`missing address for ${node.id}`);
      }
      return [address, BigInt(node.initialBalance)] as [string, bigint];
    }),
    // Extra accounts from genesis file (e.g. distribution wallet).
    ...(genesis.genesisState.accounts ?? []).map((acc) => {
      return [acc.address, BigInt(acc.balance)] as [string, bigint];
    }),
  ]),
);

const mempool: Transaction[] = [];
const blocks: StoredBlock[] = [];
const offlineValidators = new Set<string>();
const pendingProposals = new Map<string, Proposal>();
const seenTxHashes = new Set<string>();
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

const blockIntervalMs = Number(process.env.QTX_BLOCK_INTERVAL_MS ?? String(genesis.consensus.blockIntervalMs));
const peerRpcMs = genesis.network.timeouts.peerRpcMs;
const syncIntervalMs = genesis.network.timeouts.syncIntervalMs;
// External validators MUST set QTX_RPC_PORT since they have no rpcPort in config.json.
const defaultRpcPort = selfConfig?.rpcPort ?? 0;
const rpcPort = Number(process.env.QTX_RPC_PORT ?? String(defaultRpcPort));
if (rpcPort === 0) {
  throw new Error("External validator must set QTX_RPC_PORT env var.");
}
// Map our own address → endpoint so other nodes resolve us by address (not just node ID).
// Bootstrap nodes (e.g. "seednode") are keyed by string ID in genesis; active validators
// are keyed by address in state.validators. Adding the address entry here lets external
// validators find us via peerEndpointById.get(ourAddress) in produceDistributedBlock.
peerEndpointById.set(selfAddress, `http://127.0.0.1:${rpcPort}/rpc`);

// Proposer skip: counts block intervals where state.height didn't advance.
// When the scheduled proposer is offline, the slot rotates forward so the next
// online validator steps in. Resets to 0 each time a new block is committed.
let consecutiveStalls = 0;
let lastSeenHeightAtBlockTick = -1;
let shuttingDown = false;

(async () => {
  await store.open();
  await loadStateFromDisk();
  applyBootstrapOnce();
  if (!isSeedNode) void autoRegisterAsValidator();
  void discoverPeers();

  setInterval(() => {
  void (async () => {
    // Stall detection: if height hasn't advanced since last tick, rotate the
    // proposer slot forward so the next online validator can step up.
    if (state.height === lastSeenHeightAtBlockTick) {
      const maxSkip = Math.max(0, getActiveValidatorIds().length - 1);
      consecutiveStalls = Math.min(consecutiveStalls + 1, maxSkip);
    } else {
      consecutiveStalls = 0;
    }
    lastSeenHeightAtBlockTick = state.height;

    if (shuttingDown) return;
    try {
      const r = await produceDistributedBlock();
      if (r.committed) {
        console.log(
          `${ts()} [${nodeId}] ✓ block #${r.height}  proposer=${r.proposer}  txs=${r.txCount}  votes=${r.votesFor}/${r.totalValidators}  ${r.elapsedMs}ms`,
        );
        checkSeednodeHandoff();
      } else if (r.reason !== "not proposer for current height") {
        console.log(
          `${ts()} [${nodeId}] ✗ block #${r.height + 1}  ${r.reason ?? "failed"}  votes=${r.votesFor ?? 0}/${r.totalValidators ?? "?"}`,
        );
      }
    } catch (err) {
      console.error(`${ts()} [${nodeId}] block production error:`, err);
    }
  })();
}, blockIntervalMs);

setInterval(() => {
  // Run sync first so autoRegisterAsValidator sees up-to-date account/staked state.
  // If both run concurrently, autoRegisterAsValidator reads pre-sync stale state and
  // submits duplicate stake txs every cycle instead of advancing to the register step.
  void (async () => {
    try {
      await syncFromPeers();
    } catch (err: unknown) {
      console.warn(`${ts()} [${nodeId}] sync error:`, err);
    }
    if (!isSeedNode) await autoRegisterAsValidator();
  })();
}, syncIntervalMs);

const server = createServer(async (req, res) => {
  // CORS — allow browser wallets and explorers to call the RPC endpoint
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/rpc") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  let reqId: string | number | null = null;
  try {
    const body = await readBody(req);
    const rpc = JSON.parse(body) as { id?: string | number; method?: string; params?: unknown[] };
    reqId = rpc.id ?? null;

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
      id: reqId,
      result,
    });
  } catch (error) {
    const rpcError = asRpcError(error);
    sendJson(res, 200, {
      jsonrpc: "2.0",
      id: reqId,
      error: {
        code: rpcError.code,
        message: rpcError.message,
        data: rpcError.data,
      },
    });
  }
});

  server.listen(rpcPort, () => {
    console.log(`${ts()} [${nodeId}] node ready  height=${state.height}  validators=${Object.keys(state.validators).length}  peers=${peerConfigs.length}`);
    console.log(`${ts()} [${nodeId}] RPC → http://localhost:${rpcPort}/rpc  block=${blockIntervalMs}ms  sync=${syncIntervalMs}ms`);
  });
})().catch((err: unknown) => {
  console.error(`${ts()} [${nodeId}] FATAL startup error:`, err);
  process.exit(1);
});

function applyBootstrapOnce(): void {
  if (!isSeedNode || bootstrapApplied) return;

  if (state.height > 0) {
    // Chain already progressed (resumed from disk) — bootstrap already happened.
    bootstrapApplied = true;
    return;
  }

  // Seednode stakes and self-registers as the initial validator so the chain can produce blocks alone.
  const seedCfg = selfConfig as import("./config.js").SeedNodeConfig;
  const stakeAmount = BigInt(seedCfg.initialStake);
  const bootstrapTxs: Transaction[] = [
    signTx({ type: "stake", from: selfAddress, nonce: 1, amount: stakeAmount }),
    signTx({ type: "validator_register", from: selfAddress, nonce: 2, amount: 1n, validatorId: selfAddress }),
  ];

  const bootstrapResult = applyBlock(state, bootstrapTxs, protocolConfig, { verifySignature: verifier, genesisBootstrap: true });
  bootstrapApplied = true;
  if (bootstrapResult.rejected.length > 0) {
    throw new Error(`seednode genesis bootstrap failed: ${JSON.stringify(bootstrapResult.rejected)}`);
  }

  persistNodeData();
  console.log(`${ts()} [${nodeId}] 🌱 genesis bootstrap complete — seednode is now active validator`);
}

/**
 * Called periodically on validator nodes.
 * Step 1: If not staked yet, submit a stake tx.
 * Step 2: If staked but not registered, submit a validator_register tx.
 * Both txs are gossiped to all peers so the seednode (proposer) can include them.
 */
async function autoRegisterAsValidator(): Promise<void> {
  if (isSeedNode) return;

  // Announce our RPC endpoint to all known peers every cycle so they can contact us for consensus.
  // This ensures the seednode re-discovers us even after a restart.
  const selfEndpoint = `http://127.0.0.1:${rpcPort}/rpc`;
  for (const peer of peerConfigs) {
    const endpoint = peerEndpointById.get(peer.id) ?? `http://127.0.0.1:${peer.rpcPort}/rpc`;
    rpcCall(endpoint, "qtx_announcePeer", [selfAddress, selfEndpoint], peerRpcMs).catch(() => {});
  }

  // Already an active or pending validator — nothing to do.
  if (state.validators[selfAddress] || state.pendingValidators.some((p) => p.id === selfAddress)) {
    return;
  }

  const account = state.accounts[selfAddress];
  if (!account) return;

  // Stake amount: from config.json (known validators) or QTX_STAKE_AMOUNT env var (external).
  const stakeAmountStr =
    selfConfig !== undefined && !isSeedNodeConfig(selfConfig)
      ? (selfConfig as ValidatorConfig).stakeAmount
      : (process.env.QTX_STAKE_AMOUNT ?? String(protocolConfig.minValidatorStake));
  const stakeAmount = BigInt(stakeAmountStr);

  if (account.staked < protocolConfig.minValidatorStake) {
    // Haven't staked enough yet — submit stake tx.
    const needed = stakeAmount - account.staked;
    if (account.balance < needed + protocolConfig.baseFee) {
      console.warn(`${ts()} [${nodeId}] ⚠ insufficient balance to stake (have ${account.balance}, need ${needed + protocolConfig.baseFee})`);
      return;
    }
    const nonce = getNextExpectedNonce(state, mempool, selfAddress);
    try {
      const tx = signTx({ type: "stake", from: selfAddress, nonce, amount: needed });
      const { txHash } = enqueueSignedTx(tx);
      seenTxHashes.add(txHash);
      console.log(`${ts()} [${nodeId}] ⟳ auto-stake ${needed} QTX  nonce=${nonce}`);
      void gossipTransaction(tx, txHash);
    } catch {
      // nonce conflict — retry next interval
    }
    return;
  }

  // Already staked — submit validator_register tx.
  const nonce = getNextExpectedNonce(state, mempool, selfAddress);
  try {
    const tx = signTx({ type: "validator_register", from: selfAddress, nonce, amount: 1n, validatorId: selfAddress });
    const { txHash } = enqueueSignedTx(tx);
    seenTxHashes.add(txHash);
    console.log(`${ts()} [${nodeId}] ⟳ auto-register as validator  nonce=${nonce}`);
    void gossipTransaction(tx, txHash);
  } catch {
    // already in mempool — retry next interval
  }
}

function signTx(input: {
  type: Transaction["type"];
  from: string;
  nonce: number;
  amount: bigint;
  fee?: bigint;
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
    fee?: bigint;
    to?: string;
    validatorId?: string;
  },
): Transaction {
  const signer = keyByValidatorId.get(validatorByAddress.get(from)?.id ?? nodeId);
  const signerPublicKey = signer?.publicKey ?? selfKeys.publicKey;
  const txWithoutSig: Transaction = {
    ...input,
    chainId: protocolConfig.chainId,
    fee: input.fee ?? 0n,
    timestamp: Date.now(),
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
  return enqueueValidatedTx(state, mempool, tx, verifier, protocolConfig.chainId);
}

/**
 * Remove txs from the mempool whose nonce is already committed on-chain.
 * Called after block commits and after state syncs to prevent nonce-gap buildup.
 */
function pruneStaleMempool(): void {
  for (let i = mempool.length - 1; i >= 0; i--) {
    const tx = mempool[i];
    const chainNonce = state.accounts[tx.from]?.nonce ?? 0;
    if (tx.nonce <= chainNonce) {
      mempool.splice(i, 1);
    }
  }
}

/**
 * After each committed block, if this is the seednode and at least 4 external
 * validators are both active on-chain AND have announced their RPC endpoint,
 * initiate a graceful handoff: stop proposing and exit after 5 s so the
 * external validators take over block production.
 */
function checkSeednodeHandoff(): void {
  if (!isSeedNode || shuttingDown) return;
  const externalOnline = getActiveValidatorIds().filter(
    (id) => id !== selfAddress && peerEndpointById.has(id),
  );
  if (externalOnline.length >= 4) {
    shuttingDown = true;
    const preview = externalOnline.map((id) => id.slice(0, 16)).join(", ");
    console.log(
      `${ts()} [${nodeId}] 🎉 handoff: ${externalOnline.length} external validators online — seednode exiting in 5 s`,
    );
    console.log(`${ts()} [${nodeId}]    validators: ${preview}`);
    setTimeout(() => {
      console.log(`${ts()} [${nodeId}] 👋 seednode exit — chain handed off to validators`);
      process.exit(0);
    }, 5000);
  }
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
  // Shift proposer slot by stall count so offline proposers are skipped.
  const proposer = active[(state.height + consecutiveStalls) % active.length];
  return proposer === selfAddress;
}

async function produceDistributedBlock(): Promise<{
  committed: boolean;
  height: number;
  txCount: number;
  proposer: string;
  votesFor?: number;
  totalValidators?: number;
  elapsedMs?: number;
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

  const t0 = Date.now();
  // Keep batch in mempool during consensus so getNextExpectedNonce stays consistent
  // while awaiting peer votes. Committed txs are removed by hash after applyBlock.
  const batch = mempool.slice(0, genesis.consensus.maxTxPerBlock);
  const stallSuffix = consecutiveStalls > 0 ? `  skip=${consecutiveStalls}` : "";
  const expectedPeerCount = Math.max(0, getActiveValidatorIds().length - 1);
  console.log(`${ts()} [${nodeId}] → proposing block #${state.height + 1}  mempool=${batch.length} txs  asking ${expectedPeerCount} peers${stallSuffix}`);
  const proposal: Proposal = {
    height: state.height + 1,
    parentHash: state.lastBlockHash,
    proposerId: selfAddress,
    txs: batch,
    timestamp: t0,
    hash: hashProposal(state.height + 1, state.lastBlockHash, selfAddress, t0, batch),
  };

  pendingProposals.set(proposal.hash, proposal);
  const selfVote = buildVote(proposal.hash, proposal.height, selfAddress, selfKeys.privateKey, selfKeys.publicKey);

  const votes: Vote[] = [selfVote];
  const unavailable: string[] = [];

  // Consult all active validators (by on-chain address) that have a known RPC endpoint.
  // peerEndpointById is populated at startup (bootstrap nodes) and grows via qtx_announcePeer.
  const peersToConsult = getActiveValidatorIds()
    .filter((id) => id !== selfAddress)
    .map((id) => ({ id, endpoint: peerEndpointById.get(id) }))
    .filter((v): v is { id: string; endpoint: string } => v.endpoint !== undefined);

  await Promise.all(
    peersToConsult.map(async ({ id: validatorId, endpoint }) => {
      try {
        const peerVote = await rpcCall<Vote | null>(
          endpoint,
          "qtx_consensusPrepare",
          [serializeForJson(proposal)],
          peerRpcMs,
        );
        if (peerVote && verifyVote(peerVote)) {
          votes.push(peerVote);
        } else {
          unavailable.push(validatorId);
        }
      } catch {
        unavailable.push(validatorId);
      }
    }),
  );

  if (unavailable.length > 0) {
    console.warn(`${ts()} [${nodeId}] ~ consensus: peer(s) unavailable: ${unavailable.join(", ")}`);
  }
  const round = runConsensusRound(state, batch, protocolConfig, {
    verifySignature: verifier,
    unavailableValidatorIds: unavailable,
    maxMissedBlocksBeforeSlash: genesis.consensus.maxMissedBlocksBeforeSlash,
    inactivityEjectionBlocks: genesis.consensus.inactivityEjectionBlocks ?? 10000,
    inactivityBurnPercent: genesis.consensus.inactivityBurnPercent ?? 50,
    blockTimestamp: proposal.timestamp,
  });

  if (round.ejectedValidators.length > 0) {
    console.warn(
      `${ts()} [${nodeId}] ⚠ inactivity ejection: ${round.ejectedValidators.join(", ")} removed + 50% stake burned`,
    );
  }

  if (!round.committed) {
    pendingProposals.delete(proposal.hash);
    return {
      committed: false,
      height: state.height,
      txCount: 0,
      proposer: nodeId,
      votesFor: votes.length,
      totalValidators: getActiveValidatorIds().length,
      elapsedMs: Date.now() - t0,
      reason: round.reason ?? "quorum not reached",
    };
  }

  const acceptedTxs = round.applyResult?.accepted ?? [];
  // Remove the committed batch from the mempool using object identity.
  // batch = mempool.slice(0, N) holds the exact same Transaction references
  // that are in the mempool, so Set.has() (identity comparison) is unambiguous.
  // New txs submitted during peer-vote await are different object instances and
  // will not be in this Set, so they are safely preserved.
  const batchSet = new Set<Transaction>(batch);
  for (let j = mempool.length - 1; j >= 0; j--) {
    if (batchSet.has(mempool[j])) mempool.splice(j, 1);
  }
  // Also prune any remaining txs whose nonces are now stale after the committed block.
  pruneStaleMempool();

  blocks.push({
    height: state.height,
    hash: state.lastBlockHash,
    parentHash: proposal.parentHash,
    proposer: nodeId,
    txCount: acceptedTxs.length,
    timestamp: proposal.timestamp,
    txs: acceptedTxs.map(txToStored),
    committed: true,
  });
  persistNodeData();

  await Promise.all(
    peersToConsult.map(async ({ endpoint }) => {
      try {
        await rpcCall(
          endpoint,
          "qtx_consensusCommit",
          [proposal.hash, votes],
          peerRpcMs,
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
    votesFor: votes.length,
    totalValidators: getActiveValidatorIds().length,
    elapsedMs: Date.now() - t0,
  };
}

interface RpcStateSnapshot {
  nodeId: string;
  height: number;
  hash: string;
  blocks?: StoredBlock[];
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
      inactiveBlocks?: number;
    }
  >;
  pendingUnstakes: Array<{ owner: string; amount: string; unlockAt: number }>;
  offlineValidators: string[];
}

async function syncFromPeers(): Promise<void> {
  const syncPeers = Array.from(peerEndpointById.entries()).filter(([id]) => id !== selfAddress);
  const heads = await Promise.all(
    syncPeers.map(async ([peerId, endpoint]) => {
      try {
        const latest = await rpcCall<{ height: number; hash: string }>(
          endpoint,
          "qtx_getLatestBlock",
          [],
          peerRpcMs,
        );
        return { peerId, endpoint, latest };
      } catch {
        // Prune dead peers — they re-announce themselves on restart.
        peerEndpointById.delete(peerId);
        return null;
      }
    }),
  );

  const onlineCount = heads.filter((item) => item !== null).length;
  if (onlineCount < syncPeers.length) {
    console.warn(`${ts()} [${nodeId}] ~ sync: ${onlineCount}/${syncPeers.length} peers online`);
  }

  const highest = heads
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.latest.height - a.latest.height)[0];

  if (!highest || highest.latest.height <= state.height) {
    return;
  }

  const snapshot = await rpcCall<RpcStateSnapshot>(
    highest.endpoint,
    "qtx_getState",
    [],
    peerRpcMs,
  );

  const prevHeight = state.height;
  importStateSnapshot(snapshot);
  pruneStaleMempool();
  persistNodeData();
  console.log(`${ts()} [${nodeId}] ↑ synced from ${highest.peerId}  height=${state.height} (was ${prevHeight})`);
  checkSeednodeHandoff();
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
        inactiveBlocks: validator.inactiveBlocks ?? 0,
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
  state.pendingValidators = [];
}

function buildVote(proposalHash: string, height: number, voterId: string, privateKey: string, publicKey: string): Vote {
  const payload = `${proposalHash}:${height}:${voterId}`;
  return {
    proposalHash,
    height,
    voterId,
    signerPublicKey: publicKey,
    signature: signPqMessage(privateKey, payload),
  };
}

function verifyVote(vote: Vote): boolean {
  // The voter must be an active, non-slashed validator in the current state.
  const validator = state.validators[vote.voterId];
  if (!validator || !validator.active || validator.slashed) {
    return false;
  }
  // Public key must derive to the claimed voterId — prevents key substitution.
  if (deriveAddressFromPublicKey(vote.signerPublicKey) !== vote.voterId) {
    return false;
  }
  const payload = `${vote.proposalHash}:${vote.height}:${vote.voterId}`;
  return verifyPqSignature(vote.signerPublicKey, payload, vote.signature);
}

function hashProposal(height: number, parentHash: string, proposerId: string, timestamp: number, txs: Transaction[]): string {
  return createHash("sha256")
    .update(
      `${height}:${parentHash}:${proposerId}:${timestamp}:${txs
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
      const latestStored = await store.getBlock(state.height);
      return {
        height: state.height,
        hash: state.lastBlockHash,
        timestamp: latestStored?.timestamp ?? Date.now(),
        txCount: latestStored?.txs?.length ?? 0,
        proposer: latestStored?.proposer ?? "",
      };
    }
    case "qtx_getBlock": {
      const height = Number(params[0]);
      if (!Number.isInteger(height) || height < 0) {
        throw new RpcError(RpcErrorCode.INVALID_PARAMS, "height must be a non-negative integer");
      }
      const block = await store.getBlock(height);
      if (!block) {
        throw new RpcError(RpcErrorCode.NOT_FOUND, `block ${height} not found`);
      }
      return block;
    }
    case "qtx_getTransaction": {
      const txHash = String(params[0] ?? "");
      if (!txHash) {
        throw new RpcError(RpcErrorCode.INVALID_PARAMS, "missing txHash");
      }
      // search committed blocks (newest-first for speed)
      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        const found = block.txs?.find((t) => t.hash === txHash);
        if (found) {
          return { ...found, blockHeight: block.height, blockHash: block.hash, status: "committed" };
        }
      }
      // check mempool
      const pending = mempool.find((t) => hashTx(t) === txHash);
      if (pending) {
        return { ...txToStored(pending), blockHeight: null, blockHash: null, status: "pending" };
      }
      throw new RpcError(RpcErrorCode.NOT_FOUND, `transaction ${txHash} not found`);
    }
    case "qtx_getChainInfo": {
      const activeValidators = Object.values(state.validators).filter((v) => v.active && !v.slashed).length;
      return {
        chainId: genesis.chain.chainId,
        name: genesis.chain.name,
        nativeDenom: genesis.chain.nativeDenom,
        decimals: genesis.chain.decimals,
        consensus: genesis.consensus.algorithm,
        nodeId,
        height: state.height,
        blockIntervalMs,
        activeValidators,
        totalValidators: Object.keys(state.validators).length,
        mempoolSize: mempool.length,
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
      const result = enqueueSignedTx(tx);
      seenTxHashes.add(result.txHash);
      console.log(`${ts()} [${nodeId}] ← tx: ${result.txHash.slice(0, 12)}  from=${tx.from.slice(0, 16)}  type=${tx.type}  nonce=${tx.nonce}`);
      void gossipTransaction(tx, result.txHash);
      return result;
    }
    case "qtx_receivePeerTransaction": {
      const txHash = String(params[1] ?? "");
      if (!txHash) {
        throw new RpcError(RpcErrorCode.INVALID_PARAMS, "missing txHash");
      }
      if (seenTxHashes.has(txHash)) {
        return { queued: false, reason: "already seen" };
      }
      const tx = parseRpcTransactionStrict(params[0]);
      const computedHash = hashTx(tx);
      if (computedHash !== txHash) {
        throw new RpcError(RpcErrorCode.INVALID_PARAMS, "txHash mismatch", { category: "schema" });
      }
      seenTxHashes.add(txHash);
      try {
        enqueueSignedTx(tx);
      } catch {
        return { queued: false, reason: "rejected by mempool" };
      }
      void gossipTransaction(tx, txHash);
      return { queued: true };
    }
    case "qtx_getPeers": {
      const peers: Array<{ id: string; endpoint: string }> = peerConfigs.map((peer) => ({
        id: peer.id,
        endpoint: peerEndpointById.get(peer.id) ?? `http://127.0.0.1:${peer.rpcPort}/rpc`,
      }));
      for (const [id, endpoint] of peerEndpointById) {
        if (id !== selfAddress && !peers.find((p) => p.id === id)) {
          peers.push({ id, endpoint });
        }
      }
      return peers;
    }
    case "qtx_consensusPrepare": {
      const raw = params[0] as Proposal;
      if (!raw || raw.height !== state.height + 1 || raw.parentHash !== state.lastBlockHash || !raw.timestamp) {
        return null;
      }

      // Normalize txs: JSON wire format has bigint fields serialized as strings.
      const proposal: Proposal = {
        ...raw,
        txs: (raw.txs as unknown[]).map((t) => parseRpcTransactionStrict(t)),
      };

      const expected = hashProposal(proposal.height, proposal.parentHash, proposal.proposerId, proposal.timestamp, proposal.txs);
      if (proposal.hash !== expected) {
        return null;
      }

      const activeForHeight = Object.values(state.validators)
        .filter((v) => v.active && !v.slashed)
        .sort((a, b) => a.id.localeCompare(b.id));
      // Accept any active validator as proposer. Strict rotation is enforced by
      // the proposer itself (via consecutiveStalls skip). Rejecting backup
      // proposers here would stall the chain when the primary is offline.
      const isActiveValidator = activeForHeight.some((v) => v.id === proposal.proposerId);
      if (!isActiveValidator) {
        return null;
      }

      pendingProposals.set(proposal.hash, proposal);
      console.log(`${ts()} [${nodeId}] ← prepare #${proposal.height} from ${proposal.proposerId} — voted`);
      return buildVote(proposal.hash, proposal.height, selfAddress, selfKeys.privateKey, selfKeys.publicKey);
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

      const applyResult = applyBlock(state, proposal.txs, protocolConfig, { verifySignature: verifier });
      // Remove any mempool txs that are now stale (nonce <= committed chain nonce).
      // This handles gossiped txs committed by a peer block that didn't come through
      // our own proposeAndCommit path, which would otherwise corrupt getNextExpectedNonce.
      for (let j = mempool.length - 1; j >= 0; j--) {
        const mptx = mempool[j];
        const committedNonce = state.accounts[mptx.from]?.nonce ?? 0;
        if (mptx.nonce <= committedNonce) {
          mempool.splice(j, 1);
        }
      }
      blocks.push({
        height: state.height,
        hash: state.lastBlockHash,
        parentHash: proposal.parentHash,
        proposer: proposal.proposerId,
        txCount: applyResult.accepted.length,
        timestamp: proposal.timestamp,
        txs: applyResult.accepted.map(txToStored),
        committed: true,
      });
      persistNodeData();
      pendingProposals.delete(proposalHash);
      console.log(
        `${ts()} [${nodeId}] ✓ block #${state.height}  proposer=${proposal.proposerId}  txs=${applyResult.accepted.length}  (via commit)`,
      );
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
      const slashed = slashValidatorForEquivocation(state, validatorId, genesis.consensus.equivocationSlashPercent);
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
      let amount: bigint;
      try {
        amount = BigInt(String(params[1] ?? "0"));
      } catch {
        throw new RpcError(RpcErrorCode.INVALID_PARAMS, "amount must be a valid integer", {
          category: "schema",
          field: "amount",
        });
      }
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
    case "qtx_announcePeer": {
      const peerId = String(params[0] ?? "");
      const peerEndpoint = String(params[1] ?? "");
      if (peerId && peerEndpoint && peerId !== selfAddress) {
        const isNew = !peerEndpointById.has(peerId);
        if (isNew) {
          console.log(`${ts()} [${nodeId}] ↔ peer registered: ${peerId}  ${peerEndpoint}`);
          // Announce ourselves back to the newcomer so they immediately learn our address
          // (they may only have us in peerEndpointById by node ID, not address).
          const selfEndpoint = `http://127.0.0.1:${rpcPort}/rpc`;
          rpcCall(peerEndpoint, "qtx_announcePeer", [selfAddress, selfEndpoint], peerRpcMs).catch(() => {});
          // Forward the new peer to all existing known peers so they don't wait 8 s for
          // their next discoverPeers cycle to learn about the newcomer.
          for (const [existingId, existingEndpoint] of peerEndpointById) {
            if (existingId !== peerId && existingId !== selfAddress) {
              rpcCall(existingEndpoint, "qtx_announcePeer", [peerId, peerEndpoint], peerRpcMs).catch(() => {});
            }
          }
        }
        // Remove any existing entry that shares this endpoint (e.g., genesis string
        // key "seednode" replaced by the node's real address on first announce-back).
        for (const [existingId, existingEp] of peerEndpointById) {
          if (existingEp === peerEndpoint && existingId !== peerId) {
            peerEndpointById.delete(existingId);
          }
        }
        peerEndpointById.set(peerId, peerEndpoint);
      }
      return { acknowledged: true };
    }
    default:
      throw new RpcError(RpcErrorCode.METHOD_NOT_FOUND, `unsupported method: ${method}`, { method });
  }
}

async function gossipTransaction(tx: Transaction, txHash: string): Promise<void> {
  const serialized = serializeForJson(tx) as unknown;
  let gossiped = 0;
  const gossipPeers = Array.from(peerEndpointById.entries()).filter(([id]) => id !== selfAddress);
  await Promise.all(
    gossipPeers.map(async ([, endpoint]) => {
      try {
        await rpcCall(endpoint, "qtx_receivePeerTransaction", [serialized, txHash], peerRpcMs);
        gossiped++;
      } catch {
        // offline peer — ignore
      }
    }),
  );
  if (gossipPeers.length > 0) {
    console.log(`${ts()} [${nodeId}] → gossiped ${txHash.slice(0, 12)} to ${gossiped}/${gossipPeers.length} peers`);
  }
}

async function discoverPeers(): Promise<void> {
  const knownPeers = Array.from(peerEndpointById.entries()).filter(([id]) => id !== selfAddress);
  await Promise.all(
    knownPeers.map(async ([peerId, endpoint]) => {
      try {
        const discovered = await rpcCall<Array<{ id: string; endpoint: string }>>(
          endpoint,
          "qtx_getPeers",
          [],
          peerRpcMs,
        );
        for (const p of discovered) {
          if (p.id !== selfAddress && !peerEndpointById.has(p.id)) {
            peerEndpointById.set(p.id, p.endpoint);
            console.log(`${ts()} [${nodeId}] ↔ peer discovered: ${p.id}  ${p.endpoint}`);
          }
        }
      } catch {
        console.warn(`${ts()} [${nodeId}] ↔ peer unreachable: ${peerId}  ${endpoint}`);
      }
    }),
  );
}


async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  // ML-DSA-87 signatures are ~4.6 KB each (9254 hex chars). A consensus
  // prepare request with maxTxPerBlock=100 ML-DSA-87 txs is ~1.5 MB, which
  // exceeds a 1 MiB cap and silently breaks quorum. Use 32 MiB to comfortably
  // fit any realistic block proposal.
  const MAX_BODY_BYTES = 33_554_432; // 32 MiB
  let totalBytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new RpcError(RpcErrorCode.INVALID_REQUEST, "request body too large");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(serializeForJson(payload)));
  // Note: access-control-allow-origin is set at the top of the request handler
  // before sendJson is called, so it's always present.
}

function serializeForJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, current) => (typeof current === "bigint" ? current.toString() : current)),
  ) as T;
}

function fail(message: string): never {
  throw new Error(message);
}

/** Short timestamp prefix for log lines, e.g. "10:30:44.123" */
function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function txToStored(tx: Transaction): StoredTx {
  return {
    hash: hashTx(tx),
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    timestamp: tx.timestamp ?? 0,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    ...(tx.to !== undefined ? { to: tx.to } : {}),
    ...(tx.validatorId !== undefined ? { validatorId: tx.validatorId } : {}),
  };
}

async function loadStateFromDisk(): Promise<void> {
  const snapshot = await store.load();
  if (!snapshot || snapshot.nodeId !== nodeId) {
    return;
  }

  state.height = snapshot.height;
  state.lastBlockHash = snapshot.lastHash;
  state.accounts = Object.fromEntries(
    Object.entries(snapshot.accounts).map(([address, account]) => [
      address,
      { balance: BigInt(account.balance), nonce: account.nonce, staked: BigInt(account.staked) },
    ]),
  );
  state.validators = Object.fromEntries(
    Object.entries(snapshot.validators).map(([id, validator]) => [
      id,
      { ...validator, stake: BigInt(validator.stake), inactiveBlocks: validator.inactiveBlocks ?? 0 },
    ]),
  );
  state.pendingUnstakes = snapshot.pendingUnstakes.map((entry) => ({
    owner: entry.owner,
    amount: BigInt(entry.amount),
    unlockAt: entry.unlockAt,
  }));
  state.pendingValidators = snapshot.pendingValidators.map((entry) => ({
    id: entry.id,
    owner: entry.owner,
    registeredAtHeight: entry.registeredAtHeight,
  }));
  blocks.length = 0;
  for (const block of snapshot.blocks) {
    blocks.push(block);
  }
  offlineValidators.clear();
  for (const id of snapshot.offlineValidators) {
    offlineValidators.add(id);
  }
  bootstrapApplied = state.height > 0;
}

function persistNodeData(): void {
  store.save(buildNodeSnapshot());
}

function buildNodeSnapshot(): NodeSnapshot {
  return {
    nodeId,
    height: state.height,
    lastHash: state.lastBlockHash,
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
          inactiveBlocks: validator.inactiveBlocks,
        },
      ]),
    ),
    pendingUnstakes: state.pendingUnstakes.map((entry) => ({
      owner: entry.owner,
      amount: entry.amount.toString(),
      unlockAt: entry.unlockAt,
    })),
    pendingValidators: state.pendingValidators.map((entry) => ({
      id: entry.id,
      owner: entry.owner,
      registeredAtHeight: entry.registeredAtHeight,
    })),
    offlineValidators: [...offlineValidators],
  };
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
          inactiveBlocks: validator.inactiveBlocks,
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
