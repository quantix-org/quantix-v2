export type Address = string;

export const ACCOUNT_ADDRESS_PREFIX = "qtx1";
export const CONTRACT_ADDRESS_PREFIX = "qtxContract";

export type TxType =
  | "transfer"
  | "stake"
  | "unstake"
  | "validator_register"
  | "validator_unregister"
  | "contract_deploy"
  | "contract_call";

export interface Transaction {
  type: TxType;
  /** Chain ID — binds this transaction to a specific network and prevents replay attacks. */
  chainId: string;
  from: Address;
  nonce: number;
  /** Unix millisecond timestamp — set by the sender, included in the signing payload. */
  timestamp: number;
  amount: bigint;
  fee: bigint;
  signerPublicKey: string;
  signature: string;
  to?: Address;
  validatorId?: string;
  contractAddress?: Address;
  contractCode?: string;
  method?: string;
  args?: unknown[];
  gasLimit?: number;
  maxFeePerGas?: bigint;
  value?: bigint;
  salt?: string;
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
  /** Consecutive blocks this validator has not participated in. Resets to 0 on participation. */
  inactiveBlocks: number;
}

export interface PendingValidatorEntry {
  id: string;
  owner: Address;
  registeredAtHeight: number;
}

export interface ContractState {
  address: Address;
  owner: Address;
  codeHash: string;
  code: string;
  deployedAtHeight: number;
  salt?: string;
}

export interface ContractReceipt {
  txHash: string;
  type: "contract_deploy" | "contract_call";
  contractAddress: Address;
  success: boolean;
  gasUsed: number;
  blockHeight: number;
  returnData?: string;
  error?: string;
}

export interface ContractEvent {
  txHash: string;
  contractAddress: Address;
  name: string;
  data: string;
  blockHeight: number;
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
  contracts: Record<Address, ContractState>;
  contractStorage: Record<Address, Record<string, string>>;
  contractReceipts: Record<string, ContractReceipt>;
  contractEvents: ContractEvent[];
}
