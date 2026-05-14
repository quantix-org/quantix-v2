import type { ProtocolConfig } from "./types.js";

export const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = {
  chainId: "quantix-devnet",
  minValidatorStake: 32n,
  unstakeCooldownBlocks: 20,
  baseFee: 1n,
};
