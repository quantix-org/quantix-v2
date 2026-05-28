import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROTOCOL_CONFIG,
  applyBlock,
  createGenesisState,
  slashValidatorForEquivocation,
  runConsensusRound,
  transactionSigningPayload,
  type ProtocolConfig,
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
    fee: 0n,
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

  const signTx = (input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp"> & { fee?: bigint }): Transaction => {
    const keyPair = keyByAddress.get(input.from);
    if (!keyPair) {
      throw new Error("missing keypair for signer");
    }
    const unsignedTx: Transaction = {
      fee: 0n,
      timestamp: Date.now(),
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
  const dave = generatePqKeyPair();

  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const bobAddress = deriveAddressFromPublicKey(bob.publicKey);
  const carolAddress = deriveAddressFromPublicKey(carol.publicKey);
  const daveAddress = deriveAddressFromPublicKey(dave.publicKey);

  // 4 validators so quorum = floor(8/3)+1 = 3; vb can be absent while the other 3 still commit.
  const state = createGenesisState({
    [aliceAddress]: 1_000n,
    [bobAddress]: 1_000n,
    [carolAddress]: 1_000n,
    [daveAddress]: 1_000n,
  });

  const keyByAddress = new Map([
    [aliceAddress, alice],
    [bobAddress, bob],
    [carolAddress, carol],
    [daveAddress, dave],
  ]);

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const signTx = (input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp"> & { fee?: bigint }): Transaction => {
    const keyPair = keyByAddress.get(input.from);
    if (!keyPair) {
      throw new Error("missing keypair for signer");
    }
    const unsignedTx: Transaction = {
      fee: 0n,
      timestamp: Date.now(),
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
    signTx({ type: "stake", from: daveAddress, nonce: 1, amount: 100n }),
    signTx({ type: "validator_register", from: daveAddress, nonce: 2, amount: 1n, validatorId: "vd" }),
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

// ---------------------------------------------------------------------------
// Pending validator queue tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal verifySignature + signTx helper for a given key map.
 * Extracted here so the queue tests below stay concise.
 */
function makeSignHelpers(keyByAddress: Map<string, { publicKey: string; privateKey: string }>) {
  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature) ? true : "invalid pq signature";
  };

  const signTx = (input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp"> & { fee?: bigint }): Transaction => {
    const keyPair = keyByAddress.get(input.from);
    if (!keyPair) throw new Error(`missing keypair for ${input.from}`);
    const unsignedTx: Transaction = { fee: 0n, timestamp: Date.now(), ...input, signerPublicKey: keyPair.publicKey, signature: "" };
    return { ...unsignedTx, signature: signPqMessage(keyPair.privateKey, transactionSigningPayload(unsignedTx)) };
  };

  return { verifySignature, signTx };
}

test("validator_register queues to pendingValidators when epochLength > 0", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const config: ProtocolConfig = { ...DEFAULT_PROTOCOL_CONFIG, epochLength: 10 };
  const { verifySignature, signTx } = makeSignHelpers(new Map([[aliceAddress, alice]]));

  const result = applyBlock(
    state,
    [
      signTx({ type: "stake", from: aliceAddress, nonce: 1, amount: 100n }),
      signTx({ type: "validator_register", from: aliceAddress, nonce: 2, amount: 1n, validatorId: "va" }),
    ],
    config,
    { verifySignature },
  );

  assert.equal(result.rejected.length, 0, "transactions should be accepted");
  assert.equal(state.validators["va"], undefined, "validator must not be active yet");
  assert.equal(state.pendingValidators.length, 1, "validator should be in pending queue");
  assert.equal(state.pendingValidators[0].id, "va");
});

test("duplicate validator_register is rejected when already pending", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const config: ProtocolConfig = { ...DEFAULT_PROTOCOL_CONFIG, epochLength: 10 };
  const { verifySignature, signTx } = makeSignHelpers(new Map([[aliceAddress, alice]]));

  applyBlock(
    state,
    [
      signTx({ type: "stake", from: aliceAddress, nonce: 1, amount: 100n }),
      signTx({ type: "validator_register", from: aliceAddress, nonce: 2, amount: 1n, validatorId: "va" }),
    ],
    config,
    { verifySignature },
  );

  const second = applyBlock(
    state,
    [signTx({ type: "validator_register", from: aliceAddress, nonce: 3, amount: 1n, validatorId: "va" })],
    config,
    { verifySignature },
  );

  assert.equal(second.rejected.length, 1);
  assert.match(second.rejected[0].reason, /already pending/);
});

test("pending validators are activated at epoch boundary", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const epochLength = 5;
  const config: ProtocolConfig = { ...DEFAULT_PROTOCOL_CONFIG, epochLength };
  const { verifySignature, signTx } = makeSignHelpers(new Map([[aliceAddress, alice]]));

  // Block 1 — stake + register (goes to pending queue).
  applyBlock(
    state,
    [
      signTx({ type: "stake", from: aliceAddress, nonce: 1, amount: 100n }),
      signTx({ type: "validator_register", from: aliceAddress, nonce: 2, amount: 1n, validatorId: "va" }),
    ],
    config,
    { verifySignature },
  );

  assert.equal(state.height, 1);
  assert.equal(state.validators["va"], undefined, "not active before epoch boundary");
  assert.equal(state.pendingValidators.length, 1);

  // Blocks 2-4 — empty blocks, still before epoch boundary (height 5).
  for (let i = 0; i < 3; i++) {
    applyBlock(state, [], config, { verifySignature });
  }
  assert.equal(state.height, 4);
  assert.equal(state.validators["va"], undefined, "still not active at height 4");

  // Block 5 — this is the epoch boundary (nextHeight = 5 = 5 % 5 === 0).
  applyBlock(state, [], config, { verifySignature });

  assert.equal(state.height, 5);
  assert.ok(state.validators["va"], "validator should be active after epoch boundary");
  assert.equal(state.validators["va"].active, true);
  assert.equal(state.pendingValidators.length, 0, "pending queue should be empty");
});

test("maxActiveValidators caps how many pending validators are activated per epoch", () => {
  const keys = Array.from({ length: 4 }, () => generatePqKeyPair());
  const addresses = keys.map((k) => deriveAddressFromPublicKey(k.publicKey));
  const keyByAddress = new Map(keys.map((k, i) => [addresses[i], k]));

  const balances = Object.fromEntries(addresses.map((addr) => [addr, 1_000n]));
  const state = createGenesisState(balances);

  const config: ProtocolConfig = { ...DEFAULT_PROTOCOL_CONFIG, epochLength: 3, maxActiveValidators: 2 };
  const { verifySignature, signTx } = makeSignHelpers(keyByAddress);

  // Stake + register all 4 validators in block 1.
  const registerTxs = addresses.flatMap((addr, i) => [
    signTx({ type: "stake", from: addr, nonce: 1, amount: 100n }),
    signTx({ type: "validator_register", from: addr, nonce: 2, amount: 1n, validatorId: `v${i}` }),
  ]);
  applyBlock(state, registerTxs, config, { verifySignature });
  assert.equal(state.pendingValidators.length, 4, "all 4 should be queued");

  // Blocks 2-3 — reach first epoch boundary (nextHeight = 3).
  applyBlock(state, [], config, { verifySignature });
  applyBlock(state, [], config, { verifySignature });

  // Only 2 should be activated (maxActiveValidators = 2, currently 0 active).
  const activeAfterFirstEpoch = Object.values(state.validators).filter((v) => v.active).length;
  assert.equal(activeAfterFirstEpoch, 2, "first epoch activates only 2 validators");
  assert.equal(state.pendingValidators.length, 2, "2 remain in the queue");

  // Second epoch boundary (nextHeight = 6) — 2 active already, cap = 2, so 0 slots.
  applyBlock(state, [], config, { verifySignature });
  applyBlock(state, [], config, { verifySignature });
  applyBlock(state, [], config, { verifySignature });

  const activeAfterSecondEpoch = Object.values(state.validators).filter((v) => v.active).length;
  assert.equal(activeAfterSecondEpoch, 2, "cap prevents further activations when already at max");
  assert.equal(state.pendingValidators.length, 2, "remaining validators still queued");
});
