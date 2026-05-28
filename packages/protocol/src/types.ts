export type Address = string;

export type TxType = "transfer" | "stake" | "unstake" | "validator_register";

export interface Transaction {
  type: TxType;
  from: Address;
  nonce: number;
  amount: bigint;
  fee: bigint;
  signerPublicKey: string;
  signature: string;
  to?: Address;
  validatorId?: string;
}

export type SignatureVerifier = (tx: Transaction, payload: string) => true | string;

export interface AccountState {
  balance: bigint;
  nonce: number;
  staked: bigint;
}

export interface ValidatorState {
  id: string;
  owner: Address;
  stake: bigint;
  active: boolean;
  missedBlocks: number;
  slashed: boolean;
}

export interface PendingValidatorEntry {
  id: string;
  owner: Address;
  registeredAtHeight: number;
}

export interface ProtocolConfig {
  chainId: string;
  minValidatorStake: bigint;
  unstakeCooldownBlocks: number;
  baseFee: bigint;
  /** Max number of concurrently active validators. 0 = unlimited. */
  maxActiveValidators: number;
  /**
   * How many blocks between epoch boundaries at which pending validators
   * are activated. 0 = activate immediately (legacy behaviour).
   */
  epochLength: number;
}

export interface ProtocolState {
  height: number;
  lastBlockHash: string;
  accounts: Record<Address, AccountState>;
  validators: Record<string, ValidatorState>;
  pendingUnstakes: Array<{
    owner: Address;
    amount: bigint;
    unlockAt: number;
  }>;
  /** Validators whose registration is queued until the next epoch boundary. */
  pendingValidators: PendingValidatorEntry[];
}
