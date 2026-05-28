import { createHash } from "node:crypto";
import { DEFAULT_PROTOCOL_CONFIG } from "./constants.js";
import { applyBlock, transactionSigningPayload, type ApplyOptions, type ApplyResult } from "./transactions.js";
import type { ProtocolConfig, ProtocolState, Transaction } from "./types.js";

export interface BlockProposal {
  height: number;
  parentHash: string;
  proposerId: string;
  txs: Transaction[];
}

export interface ConsensusRoundResult {
  committed: boolean;
  proposalHash: string;
  proposerId: string;
  approvals: number;
  quorum: number;
  unavailableValidators: string[];
  slashedValidators: string[];
  applyResult?: ApplyResult;
  reason?: string;
}

export interface ConsensusOptions extends ApplyOptions {
  unavailableValidatorIds?: string[];
  maxMissedBlocksBeforeSlash?: number;
}

export function runConsensusRound(
  state: ProtocolState,
  txs: Transaction[],
  config: ProtocolConfig = DEFAULT_PROTOCOL_CONFIG,
  options: ConsensusOptions,
): ConsensusRoundResult {
  const activeValidators = Object.values(state.validators)
    .filter((validator) => validator.active && !validator.slashed)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (activeValidators.length === 0) {
    return {
      committed: false,
      proposalHash: "",
      proposerId: "",
      approvals: 0,
      quorum: 0,
      unavailableValidators: [],
      slashedValidators: [],
      reason: "no active validators",
    };
  }

  const quorum = Math.floor((activeValidators.length * 2) / 3) + 1;
  const unavailable = new Set(options.unavailableValidatorIds ?? []);
  const participatingValidators = activeValidators.filter((validator) => !unavailable.has(validator.id));
  const proposer = activeValidators[state.height % activeValidators.length];
  const proposal: BlockProposal = {
    height: state.height + 1,
    parentHash: state.lastBlockHash,
    proposerId: proposer.id,
    txs,
  };

  const proposalHash = hashProposal(proposal);
  const approvals = participatingValidators.length;

  // Only count missed blocks / slashes when a block is actually committed.
  // Counting on every failed retry attempt would slash validators after a
  // brief network hiccup, leaving a single proposer forever.
  if (approvals < quorum) {
    return {
      committed: false,
      proposalHash,
      proposerId: proposer.id,
      approvals,
      quorum,
      unavailableValidators: [...unavailable],
      slashedValidators: [],
      reason: "quorum not reached",
    };
  }

  const slashedValidators: string[] = [];
  for (const validator of activeValidators) {
    if (unavailable.has(validator.id)) {
      const slashed = markValidatorMissedBlock(
        state,
        validator.id,
        options.maxMissedBlocksBeforeSlash ?? 3,
      );
      if (slashed) {
        slashedValidators.push(validator.id);
      }
    } else {
      // Healthy participation resets missed block streak.
      validator.missedBlocks = 0;
      state.validators[validator.id] = validator;
    }
  }

  const applyResult = applyBlock(state, txs, config, options);
  return {
    committed: true,
    proposalHash,
    proposerId: proposer.id,
    approvals,
    quorum,
    unavailableValidators: [...unavailable],
    slashedValidators,
    applyResult,
  };
}

export function markValidatorMissedBlock(
  state: ProtocolState,
  validatorId: string,
  maxMissedBlocksBeforeSlash: number,
): boolean {
  const validator = state.validators[validatorId];
  if (!validator || validator.slashed) {
    return false;
  }

  validator.missedBlocks += 1;
  if (validator.missedBlocks >= maxMissedBlocksBeforeSlash) {
    validator.active = false;
    validator.slashed = true;
    state.validators[validatorId] = validator;
    return true;
  }

  state.validators[validatorId] = validator;
  return false;
}

export function slashValidatorForEquivocation(
  state: ProtocolState,
  validatorId: string,
  slashPercent: number = 10,
): boolean {
  const validator = state.validators[validatorId];
  if (!validator || validator.slashed) {
    return false;
  }

  const owner = state.accounts[validator.owner];
  if (!owner) {
    return false;
  }

  const slashAmount = (owner.staked * BigInt(slashPercent)) / 100n;
  owner.staked = owner.staked > slashAmount ? owner.staked - slashAmount : 0n;
  validator.stake = owner.staked;
  validator.slashed = true;
  validator.active = false;
  state.accounts[validator.owner] = owner;
  state.validators[validatorId] = validator;
  return true;
}

function hashProposal(proposal: BlockProposal): string {
  const canonicalTxs = proposal.txs.map((tx) => transactionSigningPayload(tx));
  return createHash("sha256")
    .update(`${proposal.height}:${proposal.parentHash}:${proposal.proposerId}:${canonicalTxs.join("|")}`)
    .digest("hex");
}
