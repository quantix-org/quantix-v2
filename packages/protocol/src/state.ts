import { createHash } from "node:crypto";
import type { AccountState, Address, PendingValidatorEntry, ProtocolState, ValidatorState } from "./types.js";

export function createGenesisState(initialBalances: Record<Address, bigint>): ProtocolState {
  const accounts: Record<Address, AccountState> = {};

  for (const [address, balance] of Object.entries(initialBalances)) {
    accounts[address] = {
      balance,
      nonce: 0,
      staked: 0n,
    };
  }

  return {
    height: 0,
    lastBlockHash: hashState(0, "genesis", accounts, {}, []),
    accounts,
    validators: {},
    pendingUnstakes: [],
    pendingValidators: [],
  };
}

export function cloneState(state: ProtocolState): ProtocolState {
  return {
    height: state.height,
    lastBlockHash: state.lastBlockHash,
    accounts: structuredClone(state.accounts),
    validators: structuredClone(state.validators),
    pendingUnstakes: structuredClone(state.pendingUnstakes),
    pendingValidators: structuredClone(state.pendingValidators),
  };
}

export function settlePendingUnstakes(state: ProtocolState): void {
  const releasable = state.pendingUnstakes.filter((entry) => entry.unlockAt <= state.height);
  if (releasable.length === 0) {
    return;
  }

  for (const entry of releasable) {
    const account = state.accounts[entry.owner] ?? { balance: 0n, nonce: 0, staked: 0n };
    account.balance += entry.amount;
    state.accounts[entry.owner] = account;
  }

  state.pendingUnstakes = state.pendingUnstakes.filter((entry) => entry.unlockAt > state.height);
}

export function ensureAccount(state: ProtocolState, address: Address): AccountState {
  if (!state.accounts[address]) {
    state.accounts[address] = {
      balance: 0n,
      nonce: 0,
      staked: 0n,
    };
  }

  return state.accounts[address];
}

export function updateBlockHead(
  state: ProtocolState,
  txCount: number,
  validators: Record<string, ValidatorState>,
): void {
  state.height += 1;
  state.lastBlockHash = hashState(state.height, `${state.lastBlockHash}:${txCount}`, state.accounts, validators, state.pendingValidators);
}

function hashState(
  height: number,
  seed: string,
  accounts: Record<Address, AccountState>,
  validators: Record<string, ValidatorState>,
  pending: PendingValidatorEntry[],
): string {
  const accountPairs = Object.entries(accounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([addr, data]) => `${addr}:${data.balance}:${data.nonce}:${data.staked}`)
    .join("|");

  const validatorPairs = Object.entries(validators)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, data]) => `${id}:${data.owner}:${data.stake}:${data.active}:${data.slashed}`)
    .join("|");

  const pendingPairs = [...pending]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `${p.id}:${p.owner}:${p.registeredAtHeight}`)
    .join("|");

  return createHash("sha256").update(`${height}:${seed}:${accountPairs}:${validatorPairs}:${pendingPairs}`).digest("hex");
}
