import { ClassicLevel } from "classic-level";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── Stored types ─────────────────────────────────────────────────────────────

export interface StoredAccount {
  balance: string;
  nonce: number;
  staked: string;
}

export interface StoredValidator {
  id: string;
  owner: string;
  stake: string;
  active: boolean;
  missedBlocks: number;
  slashed: boolean;
  inactiveBlocks?: number;
  cumulativeRewards?: string;
  lastRewardHeight?: number;
}

export interface StoredRewardDistribution {
  height: number;
  proposerId: string;
  totalFees: string;
  validatorFeePool: string;
  burnedFees: string;
  blockReward: string;
  rewards: Record<string, string>;
}

export interface StoredContract {
  address: string;
  owner: string;
  codeHash: string;
  code: string;
  deployedAtHeight: number;
  salt?: string;
}

export interface StoredContractReceipt {
  txHash: string;
  type: "contract_deploy" | "contract_call";
  contractAddress: string;
  success: boolean;
  gasUsed: number;
  blockHeight: number;
  returnData?: string;
  error?: string;
}

export interface StoredContractEvent {
  txHash: string;
  contractAddress: string;
  name: string;
  data: string;
  blockHeight: number;
}

export interface StoredTx {
  hash: string;
  type: string;
  from: string;
  nonce: number;
  timestamp: number;
  amount: string;
  fee: string;
  to?: string;
  validatorId?: string;
  contractAddress?: string;
  method?: string;
}

export interface StoredBlock {
  height: number;
  hash: string;
  parentHash: string;
  proposer: string;
  txCount: number;
  /** Unix millisecond timestamp when the block was committed. */
  timestamp: number;
  txs: StoredTx[];
  committed: boolean;
}

export interface StoredPendingUnstake {
  owner: string;
  amount: string;
  unlockAt: number;
}

export interface StoredPendingValidator {
  id: string;
  owner: string;
  registeredAtHeight: number;
}

export interface NodeSnapshot {
  nodeId: string;
  height: number;
  lastHash: string;
  accounts: Record<string, StoredAccount>;
  validators: Record<string, StoredValidator>;
  blocks: StoredBlock[];
  pendingUnstakes: StoredPendingUnstake[];
  pendingValidators: StoredPendingValidator[];
  contracts: Record<string, StoredContract>;
  contractStorage: Record<string, Record<string, string>>;
  contractReceipts: Record<string, StoredContractReceipt>;
  contractEvents: StoredContractEvent[];
  rewardHistory: StoredRewardDistribution[];
  offlineValidators: string[];
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

const K = {
  nodeId:            () => "meta:nodeId",
  height:            () => "meta:height",
  lastHash:          () => "meta:lastHash",
  account:           (addr: string)   => `account:${addr}`,
  validator:         (id: string)     => `validator:${id}`,
  block:             (height: number) => `block:${String(height).padStart(10, "0")}`,
  pendingUnstakes:   () => "array:pendingUnstakes",
  pendingValidators: () => "array:pendingValidators",
  contracts:         () => "map:contracts",
  contractStorage:   () => "map:contractStorage",
  contractReceipts:  () => "map:contractReceipts",
  contractEvents:    () => "array:contractEvents",
  rewardHistory:     () => "array:rewardHistory",
  offlineValidators: () => "array:offlineValidators",
} as const;

// ─── NodeStore ────────────────────────────────────────────────────────────────

export class NodeStore {
  private db: ClassicLevel<string, string>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new ClassicLevel<string, string>(join(dataDir, "leveldb"), {
      valueEncoding: "utf8",
    });
  }

  async open(): Promise<void> {
    await this.db.open();
  }

  async close(): Promise<void> {
    await this.writeQueue;
    await this.db.close();
  }

  // ── Load all persisted state ───────────────────────────────────────────────

  async load(): Promise<NodeSnapshot | null> {
      const heightStr = await this.db.get(K.height());
      if (heightStr === undefined) return null;  // fresh/empty DB
      const nodeId   = await this.db.get(K.nodeId());
      const lastHash = await this.db.get(K.lastHash());
      if (nodeId === undefined || lastHash === undefined) return null;  // partial write
      const height   = Number(heightStr);

      const accounts: Record<string, StoredAccount> = {};
      for await (const [key, value] of this.db.iterator({ gte: "account:", lte: "account:\xff" })) {
        accounts[key.slice("account:".length)] = JSON.parse(value) as StoredAccount;
      }

      const validators: Record<string, StoredValidator> = {};
      for await (const [key, value] of this.db.iterator({ gte: "validator:", lte: "validator:\xff" })) {
        const parsed = JSON.parse(value) as StoredValidator;
        validators[key.slice("validator:".length)] = {
          ...parsed,
          cumulativeRewards: parsed.cumulativeRewards ?? "0",
          lastRewardHeight: parsed.lastRewardHeight ?? 0,
        };
      }

      const blocks: StoredBlock[] = [];
      for await (const [, value] of this.db.iterator({ gte: "block:", lte: "block:\xff" })) {
        blocks.push(JSON.parse(value) as StoredBlock);
      }

      const pendingUnstakes   = await this.getJson<StoredPendingUnstake[]>(K.pendingUnstakes(),   []);
      const pendingValidators = await this.getJson<StoredPendingValidator[]>(K.pendingValidators(), []);
      const contracts         = await this.getJson<Record<string, StoredContract>>(K.contracts(), {});
      const contractStorage   = await this.getJson<Record<string, Record<string, string>>>(K.contractStorage(), {});
      const contractReceipts  = await this.getJson<Record<string, StoredContractReceipt>>(K.contractReceipts(), {});
      const contractEvents    = await this.getJson<StoredContractEvent[]>(K.contractEvents(), []);
      const rewardHistory     = await this.getJson<StoredRewardDistribution[]>(K.rewardHistory(), []);
      const offlineValidators = await this.getJson<string[]>(K.offlineValidators(), []);

      return {
        nodeId,
        height,
        lastHash,
        accounts,
        validators,
        blocks,
        pendingUnstakes,
        pendingValidators,
        contracts,
        contractStorage,
        contractReceipts,
        contractEvents,
        rewardHistory,
        offlineValidators,
      };
  }

  // ── Save (fire-and-forget, internally queued) ─────────────────────────────

  save(snapshot: NodeSnapshot): void {
    this.writeQueue = this.writeQueue
      .then(() => this.writeBatch(snapshot))
      .catch((err: unknown) => {
        console.error("[storage] write error:", err);
      });
  }

  // ── History queries (for explorer / CLI) ──────────────────────────────────

  async getBlock(height: number): Promise<StoredBlock | null> {
    return this.getJson<StoredBlock | null>(K.block(height), null);
  }

  async getAccount(address: string): Promise<StoredAccount | null> {
    return this.getJson<StoredAccount | null>(K.account(address), null);
  }

  async getValidator(id: string): Promise<StoredValidator | null> {
    return this.getJson<StoredValidator | null>(K.validator(id), null);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async writeBatch(snapshot: NodeSnapshot): Promise<void> {
    const ops: Array<{ type: "put"; key: string; value: string }> = [
      { type: "put", key: K.nodeId(),            value: snapshot.nodeId },
      { type: "put", key: K.height(),            value: String(snapshot.height) },
      { type: "put", key: K.lastHash(),          value: snapshot.lastHash },
      { type: "put", key: K.pendingUnstakes(),   value: JSON.stringify(snapshot.pendingUnstakes) },
      { type: "put", key: K.pendingValidators(), value: JSON.stringify(snapshot.pendingValidators) },
      { type: "put", key: K.contracts(),         value: JSON.stringify(snapshot.contracts) },
      { type: "put", key: K.contractStorage(),   value: JSON.stringify(snapshot.contractStorage) },
      { type: "put", key: K.contractReceipts(),  value: JSON.stringify(snapshot.contractReceipts) },
      { type: "put", key: K.contractEvents(),    value: JSON.stringify(snapshot.contractEvents) },
      { type: "put", key: K.rewardHistory(),     value: JSON.stringify(snapshot.rewardHistory) },
      { type: "put", key: K.offlineValidators(), value: JSON.stringify(snapshot.offlineValidators) },
    ];

    for (const [addr, acc] of Object.entries(snapshot.accounts)) {
      ops.push({ type: "put", key: K.account(addr),      value: JSON.stringify(acc) });
    }
    for (const [id, val] of Object.entries(snapshot.validators)) {
      ops.push({ type: "put", key: K.validator(id),      value: JSON.stringify(val) });
    }
    for (const block of snapshot.blocks) {
      ops.push({ type: "put", key: K.block(block.height), value: JSON.stringify(block) });
    }

    await this.db.batch(ops);
  }

  private async getJson<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.db.get(key);
    if (raw === undefined) return fallback;
    return JSON.parse(raw) as T;
  }
}
