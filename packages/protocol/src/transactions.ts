import { createHash } from "node:crypto";
import { DEFAULT_PROTOCOL_CONFIG } from "./constants.js";
import { ensureAccount, settlePendingUnstakes, updateBlockHead } from "./state.js";
import {
  CONTRACT_ADDRESS_PREFIX,
  type ProtocolConfig,
  type ProtocolState,
  type SignatureVerifier,
  type Transaction,
} from "./types.js";

export interface ApplyResult {
  accepted: Transaction[];
  rejected: Array<{ tx: Transaction; reason: string }>;
}

export interface ApplyOptions {
  verifySignature: SignatureVerifier;
  /** When true, validator_register activates immediately (bypasses epoch queue). Use only for genesis bootstrap. */
  genesisBootstrap?: boolean;
}

export function applyBlock(
  state: ProtocolState,
  txs: Transaction[],
  config: ProtocolConfig = DEFAULT_PROTOCOL_CONFIG,
  options: ApplyOptions,
): ApplyResult {
  settlePendingUnstakes(state);

  const accepted: Transaction[] = [];
  const rejected: Array<{ tx: Transaction; reason: string }> = [];

  for (const tx of txs) {
    const result = applyTransaction(state, tx, config, options);
    if (result === true) {
      accepted.push(tx);
    } else {
      rejected.push({ tx, reason: result });
    }
  }

  activatePendingValidators(state, config);
  updateBlockHead(state, accepted.length, state.validators);
  return { accepted, rejected };
}

export function applyTransaction(
  state: ProtocolState,
  tx: Transaction,
  config: ProtocolConfig = DEFAULT_PROTOCOL_CONFIG,
  options: ApplyOptions,
): true | string {
  if (!tx.signerPublicKey || !tx.signature) {
    return "missing signature fields";
  }

  const payload = transactionSigningPayload(tx);
  const signatureResult = options.verifySignature(tx, payload);
  if (signatureResult !== true) {
    return signatureResult;
  }

  const amountMustBePositive = tx.type !== "contract_deploy" && tx.type !== "contract_call";
  if (amountMustBePositive && tx.amount <= 0n) {
    return "amount must be > 0";
  }

  if (!amountMustBePositive && tx.amount < 0n) {
    return "amount must be >= 0";
  }

  if (tx.fee < 0n) {
    return "fee must be >= 0";
  }

  const sender = ensureAccount(state, tx.from);
  if (tx.nonce !== sender.nonce + 1) {
    return "invalid nonce";
  }

  const totalDebit = tx.amount + config.baseFee + tx.fee;
  if (sender.balance < totalDebit) {
    return "insufficient balance";
  }

  switch (tx.type) {
    case "transfer": {
      if (!tx.to) {
        return "transfer requires recipient";
      }
      const receiver = ensureAccount(state, tx.to);
      sender.balance -= totalDebit;
      receiver.balance += tx.amount;
      sender.nonce += 1;
      return true;
    }
    case "stake": {
      sender.balance -= totalDebit;
      sender.staked += tx.amount;
      sender.nonce += 1;
      return true;
    }
    case "unstake": {
      if (sender.staked < tx.amount) {
        return "insufficient staked balance";
      }
      if (sender.balance < config.baseFee + tx.fee) {
        return "insufficient balance for fees";
      }
      sender.staked -= tx.amount;
      sender.balance -= config.baseFee + tx.fee;
      sender.nonce += 1;
      state.pendingUnstakes.push({
        owner: tx.from,
        amount: tx.amount,
        unlockAt: state.height + config.unstakeCooldownBlocks,
      });
      return true;
    }
    case "validator_register": {
      // Prefer the explicit validatorId field; fall back to the sender's address.
      const id = tx.validatorId ?? tx.from;
      if (state.validators[id]) {
        return "validator already registered";
      }
      if (state.pendingValidators.some((p) => p.id === id)) {
        return "validator registration already pending";
      }
      if (sender.staked < config.minValidatorStake) {
        return "minimum stake not met";
      }

      sender.balance -= config.baseFee + tx.fee;
      sender.nonce += 1;

      if (config.epochLength > 0 && !options.genesisBootstrap) {
        // Queue for activation at next epoch boundary.
        state.pendingValidators.push({
          id,
          owner: tx.from,
          registeredAtHeight: state.height,
        });
      } else {
        // Activate immediately (genesis bootstrap or no epoch).
        state.validators[id] = {
          id,
          owner: tx.from,
          stake: sender.staked,
          active: true,
          missedBlocks: 0,
          slashed: false,
          inactiveBlocks: 0,
        };
      }
      return true;
    }
    case "validator_unregister": {
      // A validator voluntarily exits the active set and removes their registration.
      // Their staked balance is NOT burned — they may subsequently submit an `unstake` tx.
      const id = tx.validatorId ?? tx.from;
      const inValidators = !!state.validators[id];
      const pendingIdx = inValidators ? -1 : state.pendingValidators.findIndex((p) => p.id === id);
      if (!inValidators && pendingIdx === -1) {
        return "not a registered validator";
      }
      if (sender.balance < config.baseFee + tx.fee) {
        return "insufficient balance for fees";
      }
      sender.balance -= config.baseFee + tx.fee;
      sender.nonce += 1;
      if (inValidators) {
        delete state.validators[id];
      } else {
        state.pendingValidators.splice(pendingIdx, 1);
      }
      return true;
    }
    case "contract_deploy": {
      if (!tx.contractCode) {
        return "contract_deploy requires contractCode";
      }

      const contractAddress = tx.contractAddress ?? deriveContractAddress(tx.from, tx.nonce, tx.contractCode, tx.salt);
      if (state.contracts[contractAddress]) {
        return "contract already deployed";
      }

      const value = tx.value ?? tx.amount;
      if (value < 0n) {
        return "value must be >= 0";
      }

      sender.balance -= totalDebit;
      sender.nonce += 1;

      const contract = ensureAccount(state, contractAddress);
      contract.balance += value;

      state.contracts[contractAddress] = {
        address: contractAddress,
        owner: tx.from,
        codeHash: sha256Hex(tx.contractCode),
        code: tx.contractCode,
        deployedAtHeight: state.height + 1,
        ...(tx.salt ? { salt: tx.salt } : {}),
      };
      if (!state.contractStorage[contractAddress]) {
        state.contractStorage[contractAddress] = {};
      }

      return true;
    }
    case "contract_call": {
      if (!tx.contractAddress) {
        return "contract_call requires contractAddress";
      }
      if (!state.contracts[tx.contractAddress]) {
        return "contract not found";
      }

      const value = tx.value ?? tx.amount;
      if (value < 0n) {
        return "value must be >= 0";
      }

      sender.balance -= totalDebit;
      sender.nonce += 1;

      const contract = ensureAccount(state, tx.contractAddress);
      contract.balance += value;

      if (!state.contractStorage[tx.contractAddress]) {
        state.contractStorage[tx.contractAddress] = {};
      }
      // Temporary placeholder effect until WASM runtime is integrated.
      state.contractStorage[tx.contractAddress].__lastCall = JSON.stringify({
        from: tx.from,
        method: tx.method ?? null,
        args: tx.args ?? [],
        value: value.toString(),
      });

      return true;
    }
    default:
      return "unsupported transaction type";
  }
}

/**
 * At the end of each block, if this block's committed height will be an epoch
 * boundary, promote the top pending validators into the active set.
 *
 * Validators are ranked by current staked balance (desc), breaking ties by
 * registration height (asc — first-come, first-served). Candidates whose
 * stake has fallen below `minValidatorStake` since registration are dropped.
 */
function activatePendingValidators(state: ProtocolState, config: ProtocolConfig): void {
  if (config.epochLength === 0 || state.pendingValidators.length === 0) {
    return;
  }

  // nextHeight is what state.height will become after updateBlockHead.
  const nextHeight = state.height + 1;
  if (nextHeight % config.epochLength !== 0) {
    return;
  }

  const activeCount = Object.values(state.validators).filter((v) => v.active && !v.slashed).length;
  const slots =
    config.maxActiveValidators > 0
      ? Math.max(0, config.maxActiveValidators - activeCount)
      : state.pendingValidators.length;

  // Sort: highest current stake first; equal stake → registered earlier first.
  const sorted = [...state.pendingValidators].sort((a, b) => {
    const stakeA = state.accounts[a.owner]?.staked ?? 0n;
    const stakeB = state.accounts[b.owner]?.staked ?? 0n;
    if (stakeB !== stakeA) return stakeB > stakeA ? 1 : -1;
    return a.registeredAtHeight - b.registeredAtHeight;
  });

  const activated = new Set<string>();
  let remaining = slots;

  for (const pending of sorted) {
    if (remaining <= 0) break;
    const currentStake = state.accounts[pending.owner]?.staked ?? 0n;
    if (currentStake < config.minValidatorStake) {
      // Stake requirement no longer met — silently drop from queue.
      activated.add(pending.id);
      continue;
    }
    state.validators[pending.id] = {
      id: pending.id,
      owner: pending.owner,
      stake: currentStake,
      active: true,
      missedBlocks: 0,
      slashed: false,
      inactiveBlocks: 0,
    };
    activated.add(pending.id);
    remaining -= 1;
  }

  state.pendingValidators = state.pendingValidators.filter((p) => !activated.has(p.id));
}

export function transactionSigningPayload(tx: Transaction): string {
  return JSON.stringify({
    chainId: tx.chainId,
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    to: tx.to ?? null,
    validatorId: tx.validatorId ?? null,
    contractAddress: tx.contractAddress ?? null,
    contractCode: tx.contractCode ?? null,
    method: tx.method ?? null,
    args: tx.args ?? [],
    gasLimit: tx.gasLimit ?? null,
    maxFeePerGas: tx.maxFeePerGas?.toString() ?? null,
    value: tx.value?.toString() ?? null,
    salt: tx.salt ?? null,
  });
}

export function deriveContractAddress(
  deployer: string,
  nonce: number,
  contractCode: string,
  salt?: string,
): string {
  const seed = `${deployer}:${nonce}:${sha256Hex(contractCode)}:${salt ?? ""}`;
  return `${CONTRACT_ADDRESS_PREFIX}${sha256Hex(seed).slice(0, 40)}`;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
