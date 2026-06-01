export interface ExplorerRewardsConfig {
  enabled?: boolean;
  mode?: string;
  blockReward?: string;
  validatorFeeSharePercent?: number;
  proposerBonusPercent?: number;
  rewardHistoryLimit?: number;
}

export interface ExplorerChainInfo {
  chainId: string;
  name: string;
  consensus: string;
  nativeDenom: string;
  blockIntervalMs: number;
  nodeId: string;
  rewards?: ExplorerRewardsConfig;
}

export interface ExplorerTx {
  hash: string;
  type: string;
  from: string;
  to?: string;
  validatorId?: string;
  contractAddress?: string;
  amount: string;
  fee: string;
  nonce: number;
  timestamp: number;
  method?: string;
  status?: string;
  blockHeight?: number | null;
  blockHash?: string | null;
}

export interface ExplorerBlock {
  height: number;
  hash: string;
  parentHash?: string;
  timestamp: number;
  proposer: string;
  txCount: number;
  committed?: boolean;
  txs?: ExplorerTx[];
}

export interface ExplorerBalance {
  address: string;
  balance: string;
  staked: string;
  nonce: number;
}

export interface ExplorerValidator {
  id: string;
  owner?: string;
  stake: string;
  active: boolean;
  slashed?: boolean;
  missedBlocks: number;
  cumulativeRewards?: string;
  lastRewardHeight?: number;
}

export interface ExplorerPeer {
  id: string;
  endpoint: string;
}

export interface RewardDistribution {
  height: number;
  proposerId: string;
  totalFees: string;
  validatorFeePool: string;
  burnedFees: string;
  blockReward: string;
  timestamp?: number;
}

export interface ExplorerReceipt {
  success: boolean;
  gasUsed: number;
  error?: string;
}
