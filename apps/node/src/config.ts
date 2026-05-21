import { readFileSync } from "node:fs";

export interface ValidatorConfig {
  id: string;
  seedHex: string;
  rpcPort: number;
  initialBalance: string;
  initialStake: string;
}

export interface DevnetConfig {
  chainId: string;
  blockIntervalMs: number;
  validators: ValidatorConfig[];
}

export function loadDevnetConfig(configPath: string): DevnetConfig {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as DevnetConfig;

  if (!raw.validators || raw.validators.length < 3) {
    throw new Error("config must define at least 3 validators");
  }

  for (const validator of raw.validators) {
    if (!validator.id || !validator.seedHex || !validator.rpcPort) {
      throw new Error(`invalid validator config for ${validator.id ?? "unknown"}`);
    }
  }

  return raw;
}
