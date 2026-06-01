import type { ProtocolConfig } from "./types.js";

export const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = {
  chainId: "quantix-devnet",
  minValidatorStake: 32n,
  unstakeCooldownBlocks: 20,
  baseFee: 1n,
  maxActiveValidators: 0,
  epochLength: 0,
  rewardEnabled: false,
  blockReward: 0n,
  validatorFeeSharePercent: 0,
  proposerBonusPercent: 40,
  rewardMode: "hybrid",
  rewardHistoryLimit: 10000,
};
