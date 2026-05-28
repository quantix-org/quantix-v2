import { readFileSync } from "node:fs";

export interface GenesisMeta {
  format: string;
  network: string;
  createdAt: string;
}

export interface GenesisChain {
  chainId: string;
  name: string;
  addressPrefix: string;
  nativeDenom: string;
  decimals: number;
}

export interface GenesisConsensus {
  algorithm: string;
  blockIntervalMs: number;
  maxTxPerBlock: number;
  quorumRule: string;
  maxMissedBlocksBeforeSlash: number;
  equivocationSlashPercent: number;
}

export interface GenesisBootstrapNode {
  id: string;
  rpcEndpoint: string;
}

export interface GenesisProtocolParams {
  minValidatorStake: string;
  unstakeCooldownBlocks: number;
  baseFee: string;
  /**
   * How many blocks between epoch boundaries at which queued validators are
   * activated. Omit or set to 0 for immediate activation (legacy behaviour).
   */
  epochLength?: number;
  /**
   * Maximum number of concurrently active validators. Omit or set to 0 for
   * no limit.
   */
  maxActiveValidators?: number;
}

export interface GenesisNetwork {
  rpc: { path: string; jsonrpc: string };
  peerDiscovery: {
    mode: string;
    bootstrapNodes: GenesisBootstrapNode[];
  };
  timeouts: {
    peerRpcMs: number;
    syncIntervalMs: number;
  };
}

export interface GenesisAccountEntry {
  address: string;
  balance: string;
}

export interface GenesisFile {
  meta: GenesisMeta;
  chain: GenesisChain;
  consensus: GenesisConsensus;
  protocolParams: GenesisProtocolParams;
  network: GenesisNetwork;
  genesisState: {
    /** Extra pre-funded accounts (e.g. distribution wallet). Node balances come from config.json. */
    accounts?: GenesisAccountEntry[];
  };
}

export function loadGenesisFile(genesisPath: string): GenesisFile {
  const raw = JSON.parse(readFileSync(genesisPath, "utf8")) as GenesisFile;

  if (!raw.chain?.chainId) {
    throw new Error("genesis: missing chain.chainId");
  }

  if (!raw.consensus?.blockIntervalMs || !raw.consensus.maxTxPerBlock) {
    throw new Error("genesis: missing consensus parameters");
  }

  if (!raw.protocolParams?.minValidatorStake || !raw.protocolParams.baseFee) {
    throw new Error("genesis: missing protocolParams");
  }

  if (!raw.network?.peerDiscovery?.bootstrapNodes?.length) {
    throw new Error("genesis: missing network.peerDiscovery.bootstrapNodes");
  }

  if (!raw.network.timeouts?.peerRpcMs || !raw.network.timeouts.syncIntervalMs) {
    throw new Error("genesis: missing network.timeouts");
  }

  return raw;
}
