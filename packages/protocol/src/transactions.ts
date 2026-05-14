import { DEFAULT_PROTOCOL_CONFIG } from "./constants.js";
import { ensureAccount, settlePendingUnstakes, updateBlockHead } from "./state.js";
import type { ProtocolConfig, ProtocolState, SignatureVerifier, Transaction } from "./types.js";

export interface ApplyResult {
  accepted: Transaction[];
  rejected: Array<{ tx: Transaction; reason: string }>;
}

export interface ApplyOptions {
  verifySignature: SignatureVerifier;
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

  if (tx.amount <= 0n) {
    return "amount must be > 0";
  }

  const sender = ensureAccount(state, tx.from);
  if (tx.nonce !== sender.nonce + 1) {
    return "invalid nonce";
  }

  const totalDebit = tx.amount + config.baseFee;
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
      sender.staked -= tx.amount;
      sender.balance -= config.baseFee;
      sender.nonce += 1;
      state.pendingUnstakes.push({
        owner: tx.from,
        amount: tx.amount,
        unlockAt: state.height + config.unstakeCooldownBlocks,
      });
      return true;
    }
    case "validator_register": {
      if (!tx.validatorId) {
        return "validator_register requires validatorId";
      }
      if (state.validators[tx.validatorId]) {
        return "validator already exists";
      }
      if (sender.staked < config.minValidatorStake) {
        return "minimum stake not met";
      }

      sender.balance -= config.baseFee;
      sender.nonce += 1;
      state.validators[tx.validatorId] = {
        id: tx.validatorId,
        owner: tx.from,
        stake: sender.staked,
        active: true,
        missedBlocks: 0,
        slashed: false,
      };
      return true;
    }
    default:
      return "unsupported transaction type";
  }
}

export function transactionSigningPayload(tx: Transaction): string {
  return JSON.stringify({
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    amount: tx.amount.toString(),
    to: tx.to ?? null,
    validatorId: tx.validatorId ?? null,
  });
}
