/**
 * Transaction building and signing for the Quantix wallet.
 * Mirrors the server-side SDK but uses browser-safe crypto.
 */

import { signPayload } from "./crypto";

export type TxType = "transfer" | "stake" | "unstake" | "validator_register";

export const DEFAULT_CHAIN_ID = "quantix-devnet";
export const DEFAULT_FEE = 1000n;

interface BaseTxInput {
  from: string;
  publicKey: string;
  privateKey: string;
  nonce: number;
  chainId?: string;
  fee?: bigint;
}

export interface UnsignedTx {
  chainId: string;
  type: TxType;
  from: string;
  nonce: number;
  timestamp: number;
  amount: bigint;
  fee: bigint;
  to: string | null;
  validatorId: string | null;
}

/** Build the canonical signing payload — must match transactionSigningPayload on the node. */
function signingPayload(tx: UnsignedTx): string {
  return JSON.stringify({
    chainId: tx.chainId,
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    to: tx.to,
    validatorId: tx.validatorId,
  });
}

/** Serialize a signed transaction for wire submission. */
function serializeForWire(
  tx: UnsignedTx,
  signerPublicKey: string,
  signature: string
): Record<string, unknown> {
  return {
    chainId: tx.chainId,
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    to: tx.to,
    validatorId: tx.validatorId,
    signerPublicKey,
    signature,
  };
}

function buildAndSign(
  base: BaseTxInput,
  type: TxType,
  amount: bigint,
  to: string | null,
  validatorId: string | null
): Record<string, unknown> {
  const chainId = base.chainId ?? DEFAULT_CHAIN_ID;
  const fee = base.fee ?? DEFAULT_FEE;
  const tx: UnsignedTx = {
    chainId,
    type,
    from: base.from,
    nonce: base.nonce,
    timestamp: Date.now(),
    amount,
    fee,
    to,
    validatorId,
  };
  const signature = signPayload(base.privateKey, signingPayload(tx));
  return serializeForWire(tx, base.publicKey, signature);
}

export interface TransferInput extends BaseTxInput {
  to: string;
  amount: bigint;
}

export interface StakeInput extends BaseTxInput {
  amount: bigint;
  validatorId: string;
}

export interface UnstakeInput extends BaseTxInput {
  amount: bigint;
  validatorId: string;
}

export interface ValidatorRegisterInput extends BaseTxInput {
  validatorId: string;
  bondAmount: bigint;
}

export function buildTransfer(input: TransferInput): Record<string, unknown> {
  return buildAndSign(input, "transfer", input.amount, input.to, null);
}

export function buildStake(input: StakeInput): Record<string, unknown> {
  return buildAndSign(input, "stake", input.amount, null, input.validatorId);
}

export function buildUnstake(input: UnstakeInput): Record<string, unknown> {
  return buildAndSign(input, "unstake", input.amount, null, input.validatorId);
}

export function buildValidatorRegister(
  input: ValidatorRegisterInput
): Record<string, unknown> {
  return buildAndSign(
    input,
    "validator_register",
    input.bondAmount,
    null,
    input.validatorId
  );
}
