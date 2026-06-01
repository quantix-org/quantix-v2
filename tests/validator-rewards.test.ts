import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBlock,
  createGenesisState,
  DEFAULT_PROTOCOL_CONFIG,
  runConsensusRound,
  transactionSigningPayload,
  type ProtocolConfig,
  type Transaction,
} from "@quantix/protocol";
import { deriveAddressFromPublicKey, generatePqKeyPair, signPqMessage, verifyPqSignature } from "@quantix/crypto";

function makeVerifier() {
  return (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature) ? true : "invalid pq signature";
  };
}

function signTransferTx(input: {
  fromPrivateKey: string;
  fromPublicKey: string;
  from: string;
  to: string;
  nonce: number;
  amount: bigint;
  fee: bigint;
  chainId: string;
}): Transaction {
  const unsigned: Transaction = {
    type: "transfer",
    chainId: input.chainId,
    from: input.from,
    to: input.to,
    nonce: input.nonce,
    timestamp: Date.now(),
    amount: input.amount,
    fee: input.fee,
    signerPublicKey: input.fromPublicKey,
    signature: "",
  };

  return {
    ...unsigned,
    signature: signPqMessage(input.fromPrivateKey, transactionSigningPayload(unsigned)),
  };
}

test("hybrid rewards distribute fees + block reward deterministically", () => {
  const verifier = makeVerifier();

  const va = generatePqKeyPair();
  const vb = generatePqKeyPair();
  const vc = generatePqKeyPair();
  const vd = generatePqKeyPair();
  const sender = generatePqKeyPair();
  const recipient = generatePqKeyPair();

  const vaAddr = deriveAddressFromPublicKey(va.publicKey);
  const vbAddr = deriveAddressFromPublicKey(vb.publicKey);
  const vcAddr = deriveAddressFromPublicKey(vc.publicKey);
  const vdAddr = deriveAddressFromPublicKey(vd.publicKey);
  const senderAddr = deriveAddressFromPublicKey(sender.publicKey);
  const recipientAddr = deriveAddressFromPublicKey(recipient.publicKey);

  const state = createGenesisState({
    [vaAddr]: 0n,
    [vbAddr]: 0n,
    [vcAddr]: 0n,
    [vdAddr]: 0n,
    [senderAddr]: 1_000n,
    [recipientAddr]: 0n,
  });

  state.accounts[vaAddr].staked = 100n;
  state.accounts[vbAddr].staked = 100n;
  state.accounts[vcAddr].staked = 100n;
  state.accounts[vdAddr].staked = 100n;

  state.validators.va = {
    id: "va",
    owner: vaAddr,
    stake: 100n,
    active: true,
    missedBlocks: 0,
    slashed: false,
    inactiveBlocks: 0,
    cumulativeRewards: 0n,
    lastRewardHeight: 0,
  };
  state.validators.vb = {
    id: "vb",
    owner: vbAddr,
    stake: 100n,
    active: true,
    missedBlocks: 0,
    slashed: false,
    inactiveBlocks: 0,
    cumulativeRewards: 0n,
    lastRewardHeight: 0,
  };
  state.validators.vc = {
    id: "vc",
    owner: vcAddr,
    stake: 100n,
    active: true,
    missedBlocks: 0,
    slashed: false,
    inactiveBlocks: 0,
    cumulativeRewards: 0n,
    lastRewardHeight: 0,
  };
  state.validators.vd = {
    id: "vd",
    owner: vdAddr,
    stake: 100n,
    active: true,
    missedBlocks: 0,
    slashed: false,
    inactiveBlocks: 0,
    cumulativeRewards: 0n,
    lastRewardHeight: 0,
  };

  const config: ProtocolConfig = {
    ...DEFAULT_PROTOCOL_CONFIG,
    rewardEnabled: true,
    blockReward: 100n,
    validatorFeeSharePercent: 80,
    proposerBonusPercent: 40,
    rewardMode: "hybrid",
    rewardHistoryLimit: 1000,
    baseFee: 1n,
  };

  const tx = signTransferTx({
    fromPrivateKey: sender.privateKey,
    fromPublicKey: sender.publicKey,
    from: senderAddr,
    to: recipientAddr,
    nonce: 1,
    amount: 10n,
    fee: 9n,
    chainId: config.chainId,
  });

  const result = applyBlock(state, [tx], config, {
    verifySignature: verifier,
    proposerId: "va",
  });

  assert.equal(result.rejected.length, 0);
  assert.equal(state.height, 1);

  // Fees: (baseFee + fee) = 10, validator pool = 8, burn = 2.
  // Hybrid: proposer bonus = 3, equal pool = 5 => each 1, remainder 1 to proposer.
  // Proposer gets 1 + 3 + 1 + blockReward(100) = 105.
  assert.equal(state.accounts[vaAddr].balance, 105n);
  assert.equal(state.accounts[vbAddr].balance, 1n);
  assert.equal(state.accounts[vcAddr].balance, 1n);
  assert.equal(state.accounts[vdAddr].balance, 1n);

  assert.equal(state.validators.va.cumulativeRewards, 105n);
  assert.equal(state.validators.vb.cumulativeRewards, 1n);
  assert.equal(state.validators.vc.cumulativeRewards, 1n);
  assert.equal(state.validators.vd.cumulativeRewards, 1n);
  assert.equal(state.validators.va.lastRewardHeight, 1);

  assert.equal(state.rewardHistory.length, 1);
  assert.equal(state.rewardHistory[0].totalFees, 10n);
  assert.equal(state.rewardHistory[0].validatorFeePool, 8n);
  assert.equal(state.rewardHistory[0].burnedFees, 2n);
  assert.equal(state.rewardHistory[0].rewards.va, 105n);
});

test("no reward distribution when consensus round fails quorum", () => {
  const verifier = makeVerifier();

  const a = generatePqKeyPair();
  const b = generatePqKeyPair();
  const c = generatePqKeyPair();
  const d = generatePqKeyPair();

  const aAddr = deriveAddressFromPublicKey(a.publicKey);
  const bAddr = deriveAddressFromPublicKey(b.publicKey);
  const cAddr = deriveAddressFromPublicKey(c.publicKey);
  const dAddr = deriveAddressFromPublicKey(d.publicKey);

  const state = createGenesisState({
    [aAddr]: 0n,
    [bAddr]: 0n,
    [cAddr]: 0n,
    [dAddr]: 0n,
  });

  const validators = [
    ["va", aAddr],
    ["vb", bAddr],
    ["vc", cAddr],
    ["vd", dAddr],
  ] as const;

  for (const [id, owner] of validators) {
    state.accounts[owner].staked = 100n;
    state.validators[id] = {
      id,
      owner,
      stake: 100n,
      active: true,
      missedBlocks: 0,
      slashed: false,
      inactiveBlocks: 0,
      cumulativeRewards: 0n,
      lastRewardHeight: 0,
    };
  }

  const config: ProtocolConfig = {
    ...DEFAULT_PROTOCOL_CONFIG,
    rewardEnabled: true,
    blockReward: 100n,
    validatorFeeSharePercent: 80,
    proposerBonusPercent: 40,
    rewardMode: "hybrid",
    rewardHistoryLimit: 1000,
  };

  const round = runConsensusRound(state, [], config, {
    verifySignature: verifier,
    unavailableValidatorIds: ["vb", "vc"],
    maxMissedBlocksBeforeSlash: 10,
  });

  assert.equal(round.committed, false);
  assert.equal(state.height, 0);
  assert.equal(state.rewardHistory.length, 0);

  for (const [id] of validators) {
    assert.equal(state.validators[id].cumulativeRewards, 0n);
    assert.equal(state.validators[id].lastRewardHeight, 0);
  }
});
