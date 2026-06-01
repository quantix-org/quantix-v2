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
  /** Proposer validator id (address) for the block being applied. */
  proposerId?: string;
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
      if (tx.type === "contract_deploy" || tx.type === "contract_call") {
        const txHash = hashTx(tx);
        const blockHeight = state.height + 1;
        const fallbackContractAddress =
          tx.type === "contract_deploy"
            ? tx.contractAddress ?? (tx.contractCode ? deriveContractAddress(tx.from, tx.nonce, tx.contractCode, tx.salt) : `${CONTRACT_ADDRESS_PREFIX}unknown`)
            : (tx.contractAddress ?? `${CONTRACT_ADDRESS_PREFIX}unknown`);

        state.contractReceipts[txHash] = {
          txHash,
          type: tx.type,
          contractAddress: fallbackContractAddress,
          success: false,
          gasUsed: Math.max(21_000, Math.floor(estimateContractGasUsage(tx) * 0.1)),
          blockHeight,
          error: result,
        };
        state.contractEvents.push({
          txHash,
          contractAddress: fallbackContractAddress,
          name: "ContractExecutionFailed",
          data: JSON.stringify({ type: tx.type, error: result }),
          blockHeight,
        });
      }
    }
  }

  distributeValidatorRewards(state, accepted, config, options.proposerId, state.height + 1);
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

  switch (tx.type) {
    case "transfer": {
      if (!tx.to) {
        return "transfer requires recipient";
      }
      if (sender.balance < totalDebit) {
        return "insufficient balance";
      }
      const receiver = ensureAccount(state, tx.to);
      sender.balance -= totalDebit;
      receiver.balance += tx.amount;
      sender.nonce += 1;
      return true;
    }
    case "stake": {
      if (sender.balance < totalDebit) {
        return "insufficient balance";
      }
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
          cumulativeRewards: 0n,
          lastRewardHeight: 0,
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
      const vmInspection = inspectContractCodeVm(tx.contractCode);
      if (vmInspection.error) {
        return vmInspection.error;
      }

      if (tx.gasLimit === undefined) {
        return "contract_deploy requires gasLimit";
      }
      const requiredGas = estimateContractGasUsage(tx);
      if (tx.gasLimit < requiredGas) {
        return `out of gas: required ${requiredGas}, provided ${tx.gasLimit}`;
      }

      const contractAddress = tx.contractAddress ?? deriveContractAddress(tx.from, tx.nonce, tx.contractCode, tx.salt);
      if (!contractAddress.startsWith(CONTRACT_ADDRESS_PREFIX)) {
        return `contract address must start with ${CONTRACT_ADDRESS_PREFIX}`;
      }
      if (state.contracts[contractAddress]) {
        return "contract already deployed";
      }

      const value = tx.value ?? tx.amount;
      if (value < 0n) {
        return "value must be >= 0";
      }

      const deployDebit = value + config.baseFee + tx.fee;
      if (sender.balance < deployDebit) {
        return "insufficient balance";
      }

      sender.balance -= deployDebit;
      sender.nonce += 1;

      const contract = ensureAccount(state, contractAddress);
      contract.balance += value;

      const txHash = hashTx(tx);
      const blockHeight = state.height + 1;

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

      state.contractReceipts[txHash] = {
        txHash,
        type: "contract_deploy",
        contractAddress,
        success: true,
        gasUsed: requiredGas,
        blockHeight,
        returnData: "",
      };
      state.contractEvents.push({
        txHash,
        contractAddress,
        name: "ContractDeployed",
        data: JSON.stringify({ owner: tx.from, codeHash: state.contracts[contractAddress].codeHash }),
        blockHeight,
      });

      return true;
    }
    case "contract_call": {
      if (!tx.contractAddress) {
        return "contract_call requires contractAddress";
      }
      if (!state.contracts[tx.contractAddress]) {
        return "contract not found";
      }
      if (tx.gasLimit === undefined) {
        return "contract_call requires gasLimit";
      }
      const requiredGas = estimateContractGasUsage(tx) + estimateVmInstructionGas(state.contracts[tx.contractAddress].code, tx.method);
      if (tx.gasLimit < requiredGas) {
        return `out of gas: required ${requiredGas}, provided ${tx.gasLimit}`;
      }

      const value = tx.value ?? tx.amount;
      if (value < 0n) {
        return "value must be >= 0";
      }

      const callDebit = value + config.baseFee + tx.fee;
      if (sender.balance < callDebit) {
        return "insufficient balance";
      }

      sender.balance -= callDebit;
      sender.nonce += 1;

      const contract = ensureAccount(state, tx.contractAddress);
      contract.balance += value;

      const txHash = hashTx(tx);
      const blockHeight = state.height + 1;

      if (!state.contractStorage[tx.contractAddress]) {
        state.contractStorage[tx.contractAddress] = {};
      }
      const storage = state.contractStorage[tx.contractAddress];
      // Keep a deterministic call trace until WASM runtime lands.
      storage.__lastCall = safeJsonStringify({
        from: tx.from,
        method: tx.method ?? null,
        args: tx.args ?? [],
        value: value.toString(),
      });
      const contractCode = state.contracts[tx.contractAddress].code;
      const userRuntime = executeUserDefinedContractMethod(contractCode, storage, tx.method, tx.args ?? []);
      if (typeof userRuntime === "string") {
        return userRuntime;
      }
      const runtime = userRuntime ?? executeNativeContractMethod(state, tx.contractAddress, tx.from, storage, tx.method, tx.args ?? []);

      state.contractReceipts[txHash] = {
        txHash,
        type: "contract_call",
        contractAddress: tx.contractAddress,
        success: true,
        gasUsed: requiredGas,
        blockHeight,
        returnData: runtime.returnData,
      };
      state.contractEvents.push({
        txHash,
        contractAddress: tx.contractAddress,
        name: "ContractCalled",
        data: safeJsonStringify({ method: tx.method ?? null, args: tx.args ?? [], from: tx.from, returnData: runtime.returnData }),
        blockHeight,
      });
      for (const event of runtime.events) {
        state.contractEvents.push({
          txHash,
          contractAddress: tx.contractAddress,
          name: event.name,
          data: event.data,
          blockHeight,
        });
      }

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
      cumulativeRewards: 0n,
      lastRewardHeight: 0,
    };
    activated.add(pending.id);
    remaining -= 1;
  }

  state.pendingValidators = state.pendingValidators.filter((p) => !activated.has(p.id));
}

function distributeValidatorRewards(
  state: ProtocolState,
  acceptedTxs: Transaction[],
  config: ProtocolConfig,
  proposerId: string | undefined,
  blockHeight: number,
): void {
  if (!config.rewardEnabled || !proposerId) {
    return;
  }

  const activeValidators = Object.values(state.validators)
    .filter((validator) => validator.active && !validator.slashed)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (activeValidators.length === 0) {
    return;
  }

  if (!activeValidators.some((validator) => validator.id === proposerId)) {
    return;
  }

  const sharePercent = clampPercent(config.validatorFeeSharePercent);
  const proposerBonusPercent = clampPercent(config.proposerBonusPercent);

  const totalFees = acceptedTxs.reduce((sum, tx) => sum + config.baseFee + tx.fee, 0n);
  const validatorFeePool = (totalFees * BigInt(sharePercent)) / 100n;
  const burnedFees = totalFees - validatorFeePool;

  const rewardsByValidator = new Map<string, bigint>(
    activeValidators.map((validator) => [validator.id, 0n]),
  );

  if (config.rewardMode === "proposer-only") {
    rewardsByValidator.set(proposerId, validatorFeePool + config.blockReward);
  } else if (config.rewardMode === "all-equal") {
    const n = BigInt(activeValidators.length);
    const each = n === 0n ? 0n : validatorFeePool / n;
    const remainder = validatorFeePool - each * n;
    for (const validator of activeValidators) {
      rewardsByValidator.set(validator.id, each);
    }
    rewardsByValidator.set(
      proposerId,
      (rewardsByValidator.get(proposerId) ?? 0n) + remainder + config.blockReward,
    );
  } else if (config.rewardMode === "weighted-by-stake") {
    const totalStake = activeValidators.reduce((sum, validator) => {
      const account = ensureAccount(state, validator.owner);
      return sum + account.staked;
    }, 0n);

    if (totalStake > 0n) {
      let distributed = 0n;
      for (const validator of activeValidators) {
        const stake = ensureAccount(state, validator.owner).staked;
        const amount = (validatorFeePool * stake) / totalStake;
        rewardsByValidator.set(validator.id, amount);
        distributed += amount;
      }
      const remainder = validatorFeePool - distributed;
      rewardsByValidator.set(
        proposerId,
        (rewardsByValidator.get(proposerId) ?? 0n) + remainder + config.blockReward,
      );
    } else {
      rewardsByValidator.set(proposerId, validatorFeePool + config.blockReward);
    }
  } else {
    const proposerBonusPool = (validatorFeePool * BigInt(proposerBonusPercent)) / 100n;
    const equalPool = validatorFeePool - proposerBonusPool;
    const n = BigInt(activeValidators.length);
    const each = n === 0n ? 0n : equalPool / n;
    const remainder = equalPool - each * n;

    for (const validator of activeValidators) {
      rewardsByValidator.set(validator.id, each);
    }

    rewardsByValidator.set(
      proposerId,
      (rewardsByValidator.get(proposerId) ?? 0n) + proposerBonusPool + remainder + config.blockReward,
    );
  }

  for (const validator of activeValidators) {
    const amount = rewardsByValidator.get(validator.id) ?? 0n;
    const account = ensureAccount(state, validator.owner);
    account.balance += amount;
    validator.cumulativeRewards += amount;
    validator.lastRewardHeight = blockHeight;
    state.validators[validator.id] = validator;
  }

  state.rewardHistory.push({
    height: blockHeight,
    proposerId,
    totalFees,
    validatorFeePool,
    burnedFees,
    blockReward: config.blockReward,
    rewards: Object.fromEntries(rewardsByValidator.entries()),
  });

  if (config.rewardHistoryLimit > 0 && state.rewardHistory.length > config.rewardHistoryLimit) {
    state.rewardHistory.splice(0, state.rewardHistory.length - config.rewardHistoryLimit);
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.trunc(value);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
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

export function hashTx(tx: Transaction): string {
  return sha256Hex(transactionSigningPayload(tx));
}

export function estimateContractGasUsage(tx: Transaction): number {
  if (tx.type === "contract_deploy") {
    const codeBytes = Math.ceil((tx.contractCode?.length ?? 0) / 2);
    return 150_000 + codeBytes * 20;
  }
  if (tx.type === "contract_call") {
    const argSize = JSON.stringify(tx.args ?? []).length;
    return 50_000 + argSize * 5 + (tx.method?.length ?? 0) * 10;
  }
  return 21_000;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function executeNativeContractMethod(
  state: ProtocolState,
  contractAddress: string,
  caller: string,
  storage: Record<string, string>,
  method: string | undefined,
  args: unknown[],
): { returnData: string; events: Array<{ name: string; data: string }> } {
  const callMethod = (method ?? "").trim().toLowerCase();
  const events: Array<{ name: string; data: string }> = [];

  if (callMethod === "set") {
    const key = typeof args[0] === "string" && args[0] ? args[0] : "default";
    const value = toStorageValue(args[1]);
    storage[key] = value;
    events.push({ name: "StorageSet", data: safeJsonStringify({ key, value }) });
    return { returnData: value, events };
  }

  if (callMethod === "get") {
    const key = typeof args[0] === "string" && args[0] ? args[0] : "default";
    const value = storage[key] ?? "";
    events.push({ name: "StorageRead", data: safeJsonStringify({ key, found: key in storage }) });
    return { returnData: value, events };
  }

  if (callMethod === "delete") {
    const key = typeof args[0] === "string" && args[0] ? args[0] : "default";
    const existed = key in storage;
    delete storage[key];
    events.push({ name: "StorageDeleted", data: safeJsonStringify({ key, existed }) });
    return { returnData: existed ? "1" : "0", events };
  }

  if (callMethod === "increment") {
    const key = typeof args[0] === "string" && args[0] ? args[0] : "counter";
    const incrementArg = key === "counter" ? args[0] : args[1];
    const by = toBigIntSafe(incrementArg, 1n);
    const current = toBigIntSafe(storage[key], 0n);
    const next = current + by;
    storage[key] = next.toString();
    events.push({ name: "CounterIncremented", data: safeJsonStringify({ key, by: by.toString(), next: next.toString() }) });
    return { returnData: next.toString(), events };
  }

  if (callMethod === "batch_set") {
    const entries = normalizeBatchSetEntries(args[0]);
    if (!entries.length) {
      events.push({ name: "StorageBatchSet", data: safeJsonStringify({ count: 0 }) });
      return { returnData: "0", events };
    }

    const limited = entries.slice(0, 64);
    for (const [key, raw] of limited) {
      storage[key] = toStorageValue(raw);
    }
    events.push({ name: "StorageBatchSet", data: safeJsonStringify({ count: limited.length, truncated: entries.length > limited.length }) });
    return { returnData: String(limited.length), events };
  }

  if (callMethod === "transfer") {
    const to = typeof args[0] === "string" ? args[0].trim() : "";
    const amount = toBigIntSafe(args[1], 0n);
    if (!to || amount <= 0n) {
      events.push({ name: "ContractTransferRejected", data: safeJsonStringify({ to, amount: amount.toString(), reason: "invalid params" }) });
      return { returnData: "0", events };
    }

    const contractAccount = ensureAccount(state, contractAddress);
    if (contractAccount.balance < amount) {
      events.push({ name: "ContractTransferRejected", data: safeJsonStringify({ to, amount: amount.toString(), reason: "insufficient contract balance" }) });
      return { returnData: "0", events };
    }

    const recipient = ensureAccount(state, to);
    contractAccount.balance -= amount;
    recipient.balance += amount;
    events.push({ name: "ContractTransfer", data: safeJsonStringify({ to, amount: amount.toString() }) });
    return { returnData: amount.toString(), events };
  }

  if (callMethod === "token_init") {
    if (storage[tokenInitializedKey()] === "1") {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_init", reason: "already initialized" }) });
      return { returnData: "0", events };
    }

    const cfg = normalizeTokenInitArgs(args, caller);
    storage[tokenInitializedKey()] = "1";
    storage[tokenNameKey()] = cfg.name;
    storage[tokenSymbolKey()] = cfg.symbol;
    storage[tokenDecimalsKey()] = cfg.decimals.toString();
    storage[tokenOwnerKey()] = cfg.owner;
    storage[tokenTotalSupplyKey()] = cfg.initialSupply.toString();
    storage[tokenBalanceKey(cfg.owner)] = cfg.initialSupply.toString();
    events.push({ name: "TokenInitialized", data: safeJsonStringify(cfg) });
    events.push({ name: "Transfer", data: safeJsonStringify({ from: null, to: cfg.owner, amount: cfg.initialSupply.toString() }) });
    return { returnData: cfg.initialSupply.toString(), events };
  }

  if (callMethod === "token_config") {
    if (!isTokenOwner(state, contractAddress, caller, storage)) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_config", reason: "owner only" }) });
      return { returnData: "0", events };
    }
    const key = typeof args[0] === "string" ? args[0].trim() : "";
    if (!key) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_config", reason: "invalid key" }) });
      return { returnData: "0", events };
    }
    const value = toStorageValue(args[1]);
    storage[tokenMetaKey(key)] = value;
    events.push({ name: "TokenConfigSet", data: safeJsonStringify({ key, value }) });
    return { returnData: value, events };
  }

  if (callMethod === "token_transfer_ownership") {
    if (!isTokenOwner(state, contractAddress, caller, storage)) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_transfer_ownership", reason: "owner only" }) });
      return { returnData: "0", events };
    }
    const newOwner = typeof args[0] === "string" ? args[0].trim() : "";
    if (!newOwner) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_transfer_ownership", reason: "invalid new owner" }) });
      return { returnData: "0", events };
    }
    const prevOwner = storage[tokenOwnerKey()] || state.contracts[contractAddress]?.owner || "";
    storage[tokenOwnerKey()] = newOwner;
    events.push({ name: "OwnershipTransferred", data: safeJsonStringify({ previousOwner: prevOwner, newOwner }) });
    return { returnData: newOwner, events };
  }

  if (callMethod === "token_mint") {
    if (!isTokenOwner(state, contractAddress, caller, storage)) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_mint", reason: "owner only" }) });
      return { returnData: "0", events };
    }
    const to = typeof args[0] === "string" ? args[0].trim() : "";
    const amount = toBigIntSafe(args[1], 0n);
    if (!to || amount <= 0n) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_mint", reason: "invalid params" }) });
      return { returnData: "0", events };
    }
    const nextBalance = tokenBalance(storage, to) + amount;
    const nextSupply = tokenTotalSupply(storage) + amount;
    storage[tokenBalanceKey(to)] = nextBalance.toString();
    storage[tokenTotalSupplyKey()] = nextSupply.toString();
    events.push({ name: "Transfer", data: safeJsonStringify({ from: null, to, amount: amount.toString() }) });
    return { returnData: amount.toString(), events };
  }

  if (callMethod === "token_burn") {
    const from = typeof args[0] === "string" && args[0].trim() ? args[0].trim() : caller;
    const amountArg = from === caller ? args[0] : args[1];
    const amount = toBigIntSafe(amountArg, 0n);
    const callerIsOwner = isTokenOwner(state, contractAddress, caller, storage);
    if (from !== caller && !callerIsOwner) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_burn", reason: "owner only for third-party burn" }) });
      return { returnData: "0", events };
    }
    if (amount <= 0n) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_burn", reason: "invalid amount" }) });
      return { returnData: "0", events };
    }
    const balance = tokenBalance(storage, from);
    if (balance < amount) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_burn", reason: "insufficient balance" }) });
      return { returnData: "0", events };
    }
    const nextSupply = tokenTotalSupply(storage) - amount;
    storage[tokenBalanceKey(from)] = (balance - amount).toString();
    storage[tokenTotalSupplyKey()] = nextSupply.toString();
    events.push({ name: "Transfer", data: safeJsonStringify({ from, to: null, amount: amount.toString() }) });
    return { returnData: amount.toString(), events };
  }

  if (callMethod === "token_transfer") {
    const to = typeof args[0] === "string" ? args[0].trim() : "";
    const amount = toBigIntSafe(args[1], 0n);
    if (!to || amount <= 0n) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_transfer", reason: "invalid params" }) });
      return { returnData: "0", events };
    }
    if (!moveTokenBalance(storage, caller, to, amount)) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_transfer", reason: "insufficient balance" }) });
      return { returnData: "0", events };
    }
    events.push({ name: "Transfer", data: safeJsonStringify({ from: caller, to, amount: amount.toString() }) });
    return { returnData: amount.toString(), events };
  }

  if (callMethod === "token_approve") {
    const spender = typeof args[0] === "string" ? args[0].trim() : "";
    const amount = toBigIntSafe(args[1], 0n);
    if (!spender || amount < 0n) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_approve", reason: "invalid params" }) });
      return { returnData: "0", events };
    }
    storage[tokenAllowanceKey(caller, spender)] = amount.toString();
    events.push({ name: "Approval", data: safeJsonStringify({ owner: caller, spender, amount: amount.toString() }) });
    return { returnData: amount.toString(), events };
  }

  if (callMethod === "token_transfer_from") {
    const from = typeof args[0] === "string" ? args[0].trim() : "";
    const to = typeof args[1] === "string" ? args[1].trim() : "";
    const amount = toBigIntSafe(args[2], 0n);
    if (!from || !to || amount <= 0n) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_transfer_from", reason: "invalid params" }) });
      return { returnData: "0", events };
    }
    const allowance = tokenAllowance(storage, from, caller);
    if (allowance < amount) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_transfer_from", reason: "insufficient allowance" }) });
      return { returnData: "0", events };
    }
    if (!moveTokenBalance(storage, from, to, amount)) {
      events.push({ name: "TokenOperationRejected", data: safeJsonStringify({ method: "token_transfer_from", reason: "insufficient balance" }) });
      return { returnData: "0", events };
    }
    storage[tokenAllowanceKey(from, caller)] = (allowance - amount).toString();
    events.push({ name: "Transfer", data: safeJsonStringify({ from, to, amount: amount.toString() }) });
    return { returnData: amount.toString(), events };
  }

  if (callMethod === "token_balance_of") {
    const owner = typeof args[0] === "string" && args[0].trim() ? args[0].trim() : caller;
    return { returnData: tokenBalance(storage, owner).toString(), events };
  }

  if (callMethod === "token_allowance") {
    const owner = typeof args[0] === "string" ? args[0].trim() : "";
    const spender = typeof args[1] === "string" ? args[1].trim() : "";
    if (!owner || !spender) return { returnData: "0", events };
    return { returnData: tokenAllowance(storage, owner, spender).toString(), events };
  }

  if (callMethod === "token_total_supply") {
    return { returnData: tokenTotalSupply(storage).toString(), events };
  }

  events.push({ name: "ContractMethodNoop", data: safeJsonStringify({ method: method ?? null }) });
  return { returnData: "", events };
}

function executeUserDefinedContractMethod(
  contractCode: string,
  storage: Record<string, string>,
  method: string | undefined,
  args: unknown[],
): { returnData: string; events: Array<{ name: string; data: string }> } | null | string {
  const vm = parseContractVmV1(contractCode);
  if (!vm) {
    return null;
  }

  const methodName = (method ?? "").trim();
  if (!methodName) {
    return "contract_call requires method for qtx-v1 contract";
  }

  const program = vm.methods[methodName];
  if (!Array.isArray(program)) {
    return `contract method not found: ${methodName}`;
  }
  if (program.length > 256) {
    return "contract method exceeds max instructions";
  }

  const events: Array<{ name: string; data: string }> = [];
  let returnData = "";

  for (const rawStep of program) {
    const step = rawStep as VmV1Instruction;
    const op = typeof step.op === "string" ? step.op : "";

    if (op === "set") {
      if (!step.key || typeof step.key !== "string") {
        return "vm set requires key";
      }
      storage[step.key] = toStorageValue(resolveVmValue(step, args));
      continue;
    }

    if (op === "add") {
      if (!step.key || typeof step.key !== "string") {
        return "vm add requires key";
      }
      const delta = toBigIntSafe(resolveVmValue(step, args), 1n);
      const current = toBigIntSafe(storage[step.key], 0n);
      storage[step.key] = (current + delta).toString();
      continue;
    }

    if (op === "delete") {
      if (!step.key || typeof step.key !== "string") {
        return "vm delete requires key";
      }
      delete storage[step.key];
      continue;
    }

    if (op === "emit") {
      const eventName = typeof step.name === "string" && step.name ? step.name : "ContractEvent";
      events.push({
        name: eventName,
        data: safeJsonStringify(resolveVmValue(step, args)),
      });
      continue;
    }

    if (op === "return") {
      if (step.key && typeof step.key === "string") {
        returnData = storage[step.key] ?? "";
      } else {
        returnData = toStorageValue(resolveVmValue(step, args));
      }
      break;
    }

    return `unsupported vm op: ${op || "unknown"}`;
  }

  return { returnData, events };
}

interface VmV1Instruction {
  op?: unknown;
  key?: unknown;
  name?: unknown;
  arg?: unknown;
  value?: unknown;
}

interface VmV1ContractCode {
  vm: "qtx-v1";
  methods: Record<string, VmV1Instruction[]>;
}

interface VmInspectionResult {
  vm: VmV1ContractCode | null;
  error?: string;
}

const VM_V1_ALLOWED_OPS = new Set(["set", "add", "delete", "emit", "return"]);
const VM_V1_MAX_METHODS = 128;
const VM_V1_MAX_INSTRUCTIONS_PER_METHOD = 256;
const VM_V1_BASE_CALL_GAS = 10_000;
const VM_V1_GAS_PER_INSTRUCTION = 800;
const VM_V1_EMIT_GAS_BONUS = 200;
const VM_V1_STORAGE_WRITE_BONUS = 150;

function inspectContractCodeVm(contractCode: string): VmInspectionResult {
  const candidates = [contractCode, decodeHexUtf8(contractCode)].filter((v): v is string => typeof v === "string" && v.length > 0);

  for (const source of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== "object") continue;
    const candidate = parsed as Record<string, unknown>;
    if (!("vm" in candidate)) continue;

    if (candidate.vm !== "qtx-v1") {
      return { vm: null, error: `unsupported contract vm: ${String(candidate.vm)}` };
    }
    if (!candidate.methods || typeof candidate.methods !== "object" || Array.isArray(candidate.methods)) {
      return { vm: null, error: "qtx-v1 contract requires methods object" };
    }

    const vm: VmV1ContractCode = {
      vm: "qtx-v1",
      methods: candidate.methods as Record<string, VmV1Instruction[]>,
    };
    const validationError = validateVmV1Contract(vm);
    if (validationError) {
      return { vm: null, error: validationError };
    }
    return { vm };
  }

  return { vm: null };
}

function validateVmV1Contract(vm: VmV1ContractCode): string | null {
  const names = Object.keys(vm.methods);
  if (!names.length) {
    return "qtx-v1 contract must define at least one method";
  }
  if (names.length > VM_V1_MAX_METHODS) {
    return `qtx-v1 contract exceeds max methods (${VM_V1_MAX_METHODS})`;
  }

  for (const methodName of names) {
    if (!methodName.trim()) {
      return "qtx-v1 method name must be non-empty";
    }
    const program = vm.methods[methodName];
    if (!Array.isArray(program)) {
      return `qtx-v1 method '${methodName}' must be an instruction array`;
    }
    if (program.length > VM_V1_MAX_INSTRUCTIONS_PER_METHOD) {
      return `qtx-v1 method '${methodName}' exceeds max instructions (${VM_V1_MAX_INSTRUCTIONS_PER_METHOD})`;
    }
    for (const rawStep of program) {
      if (!rawStep || typeof rawStep !== "object") {
        return `qtx-v1 method '${methodName}' contains non-object instruction`;
      }
      const step = rawStep as VmV1Instruction;
      const op = typeof step.op === "string" ? step.op : "";
      if (!VM_V1_ALLOWED_OPS.has(op)) {
        return `qtx-v1 method '${methodName}' contains unsupported op '${op || "unknown"}'`;
      }
    }
  }

  return null;
}

function parseContractVmV1(contractCode: string): VmV1ContractCode | null {
  return inspectContractCodeVm(contractCode).vm;
}

function resolveVmArgIndex(candidate: unknown, args: unknown[]): number | null {
  const parsed = typeof candidate === "number"
    ? candidate
    : (typeof candidate === "string" ? Number(candidate) : Number.NaN);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < args.length) {
    return parsed;
  }
  return null;
}

function resolveVmValue(step: VmV1Instruction, args: unknown[]): unknown {
  const argIndex = resolveVmArgIndex(step.arg, args);
  if (argIndex !== null) {
    return args[argIndex];
  }

  // Support value-style placeholders: { "$arg": 0 }.
  if (step.value && typeof step.value === "object" && !Array.isArray(step.value)) {
    const placeholder = (step.value as Record<string, unknown>).$arg;
    const valueArgIndex = resolveVmArgIndex(placeholder, args);
    if (valueArgIndex !== null) {
      return args[valueArgIndex];
    }
  }

  return step.value;
}

function decodeHexUtf8(input: string): string | null {
  if (!input || input.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/i.test(input)) return null;
  try {
    return Buffer.from(input, "hex").toString("utf8");
  } catch {
    return null;
  }
}

function estimateVmInstructionGas(contractCode: string, method: string | undefined): number {
  const vm = parseContractVmV1(contractCode);
  if (!vm) return 0;
  const methodName = (method ?? "").trim();
  if (!methodName) return 0;
  const program = vm.methods[methodName];
  if (!Array.isArray(program)) return 0;

  let gas = VM_V1_BASE_CALL_GAS;
  for (const rawStep of program) {
    const step = rawStep as VmV1Instruction;
    const op = typeof step.op === "string" ? step.op : "";
    gas += VM_V1_GAS_PER_INSTRUCTION;
    if (op === "emit") gas += VM_V1_EMIT_GAS_BONUS;
    if (op === "set" || op === "add" || op === "delete") gas += VM_V1_STORAGE_WRITE_BONUS;
  }
  return gas;
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry));
}

function toStorageValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    return Math.trunc(value).toString();
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return safeJsonStringify(value);
}

function toBigIntSafe(value: unknown, fallback: bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fallback;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return fallback;
    try {
      return BigInt(normalized);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeBatchSetEntries(value: unknown): Array<[string, unknown]> {
  if (!Array.isArray(value)) return [];
  const out: Array<[string, unknown]> = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const key = typeof item[0] === "string" ? item[0].trim() : "";
    if (!key) continue;
    out.push([key, item[1]]);
  }
  return out;
}

function tokenInitializedKey(): string {
  return "token:initialized";
}

function tokenNameKey(): string {
  return "token:name";
}

function tokenSymbolKey(): string {
  return "token:symbol";
}

function tokenDecimalsKey(): string {
  return "token:decimals";
}

function tokenOwnerKey(): string {
  return "token:owner";
}

function tokenTotalSupplyKey(): string {
  return "token:totalSupply";
}

function tokenBalanceKey(owner: string): string {
  return `token:bal:${owner}`;
}

function tokenAllowanceKey(owner: string, spender: string): string {
  return `token:allow:${owner}:${spender}`;
}

function tokenMetaKey(key: string): string {
  return `token:meta:${key}`;
}

function tokenBalance(storage: Record<string, string>, owner: string): bigint {
  return toBigIntSafe(storage[tokenBalanceKey(owner)] ?? "0", 0n);
}

function tokenAllowance(storage: Record<string, string>, owner: string, spender: string): bigint {
  return toBigIntSafe(storage[tokenAllowanceKey(owner, spender)] ?? "0", 0n);
}

function tokenTotalSupply(storage: Record<string, string>): bigint {
  return toBigIntSafe(storage[tokenTotalSupplyKey()] ?? "0", 0n);
}

function moveTokenBalance(storage: Record<string, string>, from: string, to: string, amount: bigint): boolean {
  const fromBalance = tokenBalance(storage, from);
  if (fromBalance < amount) return false;
  const toBalance = tokenBalance(storage, to);
  storage[tokenBalanceKey(from)] = (fromBalance - amount).toString();
  storage[tokenBalanceKey(to)] = (toBalance + amount).toString();
  return true;
}

function isTokenOwner(state: ProtocolState, contractAddress: string, caller: string, storage: Record<string, string>): boolean {
  const owner = storage[tokenOwnerKey()] || state.contracts[contractAddress]?.owner || "";
  return owner === caller;
}

function normalizeTokenInitArgs(args: unknown[], defaultOwner: string): {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: bigint;
  owner: string;
} {
  const first = args[0];
  const second = args[1];
  const third = args[2];
  const fourth = args[3];
  const fifth = args[4];

  if (first && typeof first === "object" && !Array.isArray(first)) {
    const obj = first as Record<string, unknown>;
    const decimals = Number(obj.decimals ?? 18);
    return {
      name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Quantix Token",
      symbol: typeof obj.symbol === "string" && obj.symbol.trim() ? obj.symbol.trim() : "QTXT",
      decimals: Number.isFinite(decimals) ? Math.max(0, Math.min(30, Math.trunc(decimals))) : 18,
      initialSupply: toBigIntSafe(obj.initialSupply, 0n),
      owner: typeof obj.owner === "string" && obj.owner.trim() ? obj.owner.trim() : defaultOwner,
    };
  }

  const dec = Number(third ?? 18);
  return {
    name: typeof first === "string" && first.trim() ? first.trim() : "Quantix Token",
    symbol: typeof second === "string" && second.trim() ? second.trim() : "QTXT",
    decimals: Number.isFinite(dec) ? Math.max(0, Math.min(30, Math.trunc(dec))) : 18,
    initialSupply: toBigIntSafe(fourth, 0n),
    owner: typeof fifth === "string" && fifth.trim() ? fifth.trim() : defaultOwner,
  };
}
