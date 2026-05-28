import { createHash } from "node:crypto";
import { DEFAULT_PROTOCOL_CONFIG } from "./constants.js";
import { applyBlock, transactionSigningPayload, type ApplyOptions, type ApplyResult } from "./transactions.js";
import type { ProtocolConfig, ProtocolState, Transaction } from "./types.js";

export interface BlockProposal {
  height: number;
  parentHash: string;
  proposerId: string;
  txs: Transaction[];
  /** Unix millisecond timestamp — set by proposer at proposal time. */
  timestamp: number;
}

export interface ConsensusRoundResult {
  committed: boolean;
  proposalHash: string;
  proposerId: string;
  approvals: number;
  quorum: number;
  unavailableValidators: string[];
  slashedValidators: string[];
  ejectedValidators: string[];
  applyResult?: ApplyResult;
  reason?: string;
}

export interface ConsensusOptions extends ApplyOptions {
  unavailableValidatorIds?: string[];
  maxMissedBlocksBeforeSlash?: number;
  /**
   * Consecutive blocks of inactivity before a validator is forcibly ejected
   * and has `inactivityBurnPercent` of their stake burned. Default: 10000.
   */
  inactivityEjectionBlocks?: number;
  /**
   * Percentage of staked balance burned when a validator is ejected for
   * prolonged inactivity. Default: 50.
   */
  inactivityBurnPercent?: number;
  /** Unix millisecond timestamp of the block being proposed. Defaults to Date.now(). */
  blockTimestamp?: number;
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
      ejectedValidators: [],
      reason: "no active validators",
    };
  }

  // Byzantine fault-tolerant quorum: floor(2n/3)+1 — tolerates floor((n-1)/3) failures.
  // n=4 → 3, n=10 → 7, n=20 → 14. Scales correctly for larger validator sets.
  const quorum = Math.floor((activeValidators.length * 2) / 3) + 1;
  const unavailable = new Set(options.unavailableValidatorIds ?? []);
  const participatingValidators = activeValidators.filter((validator) => !unavailable.has(validator.id));
  const proposer = activeValidators[state.height % activeValidators.length];
  const proposal: BlockProposal = {
    height: state.height + 1,
    parentHash: state.lastBlockHash,
    proposerId: proposer.id,
    txs,
    timestamp: options.blockTimestamp ?? Date.now(),
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
      ejectedValidators: [],
      reason: "quorum not reached",
    };
  }

  const slashedValidators: string[] = [];
  const ejectedValidators: string[] = [];
  const participatingIds = new Set(participatingValidators.map((v) => v.id));
  const ejectionThreshold = options.inactivityEjectionBlocks ?? 10000;
  const burnPercent = options.inactivityBurnPercent ?? 50;

  // Single pass over ALL registered validators:
  //  • Participating  → reset missedBlocks + inactiveBlocks
  //  • Unavailable-active → markValidatorMissedBlock (existing slash logic) + inactiveBlocks++
  //  • Already-slashed → inactiveBlocks++
  // Any validator reaching ejectionThreshold consecutive inactive blocks is
  // removed from the validator set and loses burnPercent% of their stake.
  for (const vid of Object.keys(state.validators)) {
    const v = state.validators[vid];
    if (!v) continue;

    if (participatingIds.has(vid)) {
      v.missedBlocks = 0;
      v.inactiveBlocks = 0;
      state.validators[vid] = v;
    } else {
      v.inactiveBlocks = (v.inactiveBlocks ?? 0) + 1;

      // Apply missed-block slash for active validators that were called but unavailable.
      if (!v.slashed && unavailable.has(vid)) {
        const wasSlashed = markValidatorMissedBlock(
          state,
          vid,
          options.maxMissedBlocksBeforeSlash ?? 3,
        );
        if (wasSlashed) slashedValidators.push(vid);
      } else {
        state.validators[vid] = v;
      }

      // Check inactivity ejection (re-read in case markValidatorMissedBlock mutated state).
      const current = state.validators[vid];
      if (current && current.inactiveBlocks >= ejectionThreshold) {
        ejectInactiveValidator(state, vid, burnPercent);
        ejectedValidators.push(vid);
      }
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
    ejectedValidators,
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

/**
 * Hard-eject a validator that has exceeded the inactivity threshold:
 * removes their record from the validator set and burns `burnPercent`% of
 * their staked balance. The remaining stake stays in their account so they
 * can unstake it after the cooldown period.
 */
function ejectInactiveValidator(
  state: ProtocolState,
  validatorId: string,
  burnPercent: number,
): void {
  const v = state.validators[validatorId];
  if (!v) return;

  const owner = state.accounts[v.owner];
  if (owner && owner.staked > 0n) {
    const burnAmount = (owner.staked * BigInt(burnPercent)) / 100n;
    owner.staked = owner.staked > burnAmount ? owner.staked - burnAmount : 0n;
    state.accounts[v.owner] = owner;
  }

  delete state.validators[validatorId];
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
    .update(`${proposal.height}:${proposal.parentHash}:${proposal.proposerId}:${proposal.timestamp}:${canonicalTxs.join("|")}`)
    .digest("hex");
}
