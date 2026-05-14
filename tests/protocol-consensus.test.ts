import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROTOCOL_CONFIG,
  applyBlock,
  createGenesisState,
  slashValidatorForEquivocation,
  runConsensusRound,
  transactionSigningPayload,
  type Transaction,
} from "@quantix/protocol";
import {
  deriveAddressFromPublicKey,
  generatePqKeyPair,
  signPqMessage,
  verifyPqSignature,
} from "@quantix/crypto";

test("rejects invalid signature", () => {
  const alice = generatePqKeyPair();
  const bob = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const bobAddress = deriveAddressFromPublicKey(bob.publicKey);

  const state = createGenesisState({
    [aliceAddress]: 100n,
    [bobAddress]: 0n,
  });

  const tx: Transaction = {
    type: "transfer",
    from: aliceAddress,
    to: bobAddress,
    nonce: 1,
    amount: 10n,
    signerPublicKey: alice.publicKey,
    signature: "deadbeef",
  };

  const result = applyBlock(state, [tx], DEFAULT_PROTOCOL_CONFIG, {
    verifySignature: (candidate, payload) => {
      if (deriveAddressFromPublicKey(candidate.signerPublicKey) !== candidate.from) {
        return "signer address mismatch";
      }
      return verifyPqSignature(candidate.signerPublicKey, payload, candidate.signature)
        ? true
        : "invalid pq signature";
    },
  });

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /invalid pq signature/);
});

test("commits block when quorum is met", () => {
  const alice = generatePqKeyPair();
  const bob = generatePqKeyPair();
  const carol = generatePqKeyPair();

  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const bobAddress = deriveAddressFromPublicKey(bob.publicKey);
  const carolAddress = deriveAddressFromPublicKey(carol.publicKey);

  const state = createGenesisState({
    [aliceAddress]: 1_000n,
    [bobAddress]: 1_000n,
    [carolAddress]: 1_000n,
  });

  const keyByAddress = new Map([
    [aliceAddress, alice],
    [bobAddress, bob],
    [carolAddress, carol],
  ]);

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const signTx = (input: Omit<Transaction, "signerPublicKey" | "signature">): Transaction => {
    const keyPair = keyByAddress.get(input.from);
    if (!keyPair) {
      throw new Error("missing keypair for signer");
    }
    const unsignedTx: Transaction = {
      ...input,
      signerPublicKey: keyPair.publicKey,
      signature: "",
    };
    const payload = transactionSigningPayload(unsignedTx);
    return {
      ...unsignedTx,
      signature: signPqMessage(keyPair.privateKey, payload),
    };
  };

  const bootstrap = [
    signTx({ type: "stake", from: aliceAddress, nonce: 1, amount: 100n }),
    signTx({ type: "validator_register", from: aliceAddress, nonce: 2, amount: 1n, validatorId: "va" }),
    signTx({ type: "stake", from: bobAddress, nonce: 1, amount: 100n }),
    signTx({ type: "validator_register", from: bobAddress, nonce: 2, amount: 1n, validatorId: "vb" }),
    signTx({ type: "stake", from: carolAddress, nonce: 1, amount: 100n }),
    signTx({ type: "validator_register", from: carolAddress, nonce: 2, amount: 1n, validatorId: "vc" }),
  ];

  const bootstrapResult = applyBlock(state, bootstrap, DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(bootstrapResult.rejected.length, 0);

  const round = runConsensusRound(
    state,
    [signTx({ type: "transfer", from: aliceAddress, to: bobAddress, nonce: 3, amount: 20n })],
    DEFAULT_PROTOCOL_CONFIG,
    { verifySignature },
  );

  assert.equal(round.committed, true);
  assert.equal(round.quorum, 3);
  assert.equal(round.approvals, 3);
  assert.equal(round.applyResult?.rejected.length, 0);
  assert.equal(state.height, 2);
});

test("slashes validator after repeated downtime", () => {
  const alice = generatePqKeyPair();
  const bob = generatePqKeyPair();
  const carol = generatePqKeyPair();

  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const bobAddress = deriveAddressFromPublicKey(bob.publicKey);
  const carolAddress = deriveAddressFromPublicKey(carol.publicKey);

  const state = createGenesisState({
    [aliceAddress]: 1_000n,
    [bobAddress]: 1_000n,
    [carolAddress]: 1_000n,
  });

  const keyByAddress = new Map([
    [aliceAddress, alice],
    [bobAddress, bob],
    [carolAddress, carol],
  ]);

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const signTx = (input: Omit<Transaction, "signerPublicKey" | "signature">): Transaction => {
    const keyPair = keyByAddress.get(input.from);
    if (!keyPair) {
      throw new Error("missing keypair for signer");
    }
    const unsignedTx: Transaction = {
      ...input,
      signerPublicKey: keyPair.publicKey,
      signature: "",
    };
    const payload = transactionSigningPayload(unsignedTx);
    return {
      ...unsignedTx,
      signature: signPqMessage(keyPair.privateKey, payload),
    };
  };

  const bootstrap = [
    signTx({ type: "stake", from: aliceAddress, nonce: 1, amount: 100n }),
    signTx({ type: "validator_register", from: aliceAddress, nonce: 2, amount: 1n, validatorId: "va" }),
    signTx({ type: "stake", from: bobAddress, nonce: 1, amount: 100n }),
    signTx({ type: "validator_register", from: bobAddress, nonce: 2, amount: 1n, validatorId: "vb" }),
    signTx({ type: "stake", from: carolAddress, nonce: 1, amount: 100n }),
    signTx({ type: "validator_register", from: carolAddress, nonce: 2, amount: 1n, validatorId: "vc" }),
  ];

  const bootstrapResult = applyBlock(state, bootstrap, DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(bootstrapResult.rejected.length, 0);

  for (let i = 0; i < 3; i += 1) {
    runConsensusRound(state, [], DEFAULT_PROTOCOL_CONFIG, {
      verifySignature,
      unavailableValidatorIds: ["vb"],
      maxMissedBlocksBeforeSlash: 3,
    });
  }

  assert.equal(state.validators.vb.slashed, true);
  assert.equal(state.validators.vb.active, false);
});

test("slashes validator for equivocation", () => {
  const owner = generatePqKeyPair();
  const ownerAddress = deriveAddressFromPublicKey(owner.publicKey);
  const state = createGenesisState({ [ownerAddress]: 1_000n });

  state.accounts[ownerAddress].staked = 100n;
  state.validators.v1 = {
    id: "v1",
    owner: ownerAddress,
    stake: 100n,
    active: true,
    missedBlocks: 0,
    slashed: false,
  };

  const result = slashValidatorForEquivocation(state, "v1", 10);
  assert.equal(result, true);
  assert.equal(state.validators.v1.slashed, true);
  assert.equal(state.validators.v1.active, false);
  assert.equal(state.accounts[ownerAddress].staked, 90n);
});
