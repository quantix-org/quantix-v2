import { readFileSync } from "node:fs";

/** The first node that starts the chain. Self-bootstraps as genesis validator. */
export interface SeedNodeConfig {
  id: string;
  seedHex: string;
  rpcPort: number;
  initialBalance: string;
  /** How much the seednode stakes to become the initial active validator. */
  initialStake: string;
}

/** A node that joins after genesis, stakes, and self-registers as a validator. */
export interface ValidatorConfig {
  id: string;
  seedHex: string;
  rpcPort: number;
  initialBalance: string;
  /** How much this node will stake when auto-registering. */
  stakeAmount: string;
}

export type AnyNodeConfig = SeedNodeConfig | ValidatorConfig;

export interface DevnetConfig {
  seedNode: SeedNodeConfig;
  validators: ValidatorConfig[];
}

export function isSeedNodeConfig(cfg: AnyNodeConfig): cfg is SeedNodeConfig {
  return "initialStake" in cfg;
}

export function loadDevnetConfig(configPath: string): DevnetConfig {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as DevnetConfig;

  if (!raw.seedNode?.id || !raw.seedNode.seedHex || !raw.seedNode.rpcPort) {
    throw new Error("config: seedNode must have id, seedHex, and rpcPort");
  }

  if (!raw.validators) {
    throw new Error("config: 'validators' array must be present (can be empty)");
  }

  for (const validator of raw.validators) {
    if (!validator.id || !validator.seedHex || !validator.rpcPort) {
      throw new Error(`config: invalid validator entry for '${validator.id ?? "unknown"}'`);
    }
  }

  return raw;
}
