import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROTOCOL_CONFIG,
  applyBlock,
  createGenesisState,
  deriveContractAddress,
  hashTx,
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
    chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
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

  const signTx = (input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & { fee?: bigint; chainId?: string }): Transaction => {
    const keyPair = keyByAddress.get(input.from);
    if (!keyPair) {
      throw new Error("missing keypair for signer");
    }
    const unsignedTx: Transaction = {
      chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
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

  const signTx = (input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & { fee?: bigint; chainId?: string }): Transaction => {
    const keyPair = keyByAddress.get(input.from);
    if (!keyPair) throw new Error(`missing keypair for ${input.from}`);
    const unsignedTx: Transaction = { chainId: DEFAULT_PROTOCOL_CONFIG.chainId, fee: 0n, timestamp: Date.now(), ...input, signerPublicKey: keyPair.publicKey, signature: "" };
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

test("deriveContractAddress is deterministic", () => {
  const deployer = "qtx1deployer000000000000000000000000000000";
  const code = "aabbccdd";

  const a1 = deriveContractAddress(deployer, 7, code, "tenant-a");
  const a2 = deriveContractAddress(deployer, 7, code, "tenant-a");
  const b = deriveContractAddress(deployer, 8, code, "tenant-a");

  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.ok(a1.startsWith("qtxContract"));
});

test("contract_deploy then contract_call updates contract state", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const signTx = (
    input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & {
      fee?: bigint;
      chainId?: string;
    },
  ): Transaction => {
    const unsignedTx: Transaction = {
      chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
      fee: 0n,
      timestamp: Date.now(),
      ...input,
      signerPublicKey: alice.publicKey,
      signature: "",
    };
    return {
      ...unsignedTx,
      signature: signPqMessage(alice.privateKey, transactionSigningPayload(unsignedTx)),
    };
  };

  const deploy = signTx({
    type: "contract_deploy",
    from: aliceAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractCode: "aabbccdd",
    gasLimit: 200000,
    maxFeePerGas: 1n,
    salt: "contract-1",
  });

  const deployResult = applyBlock(state, [deploy], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(deployResult.rejected.length, 0);

  const contractAddress = deriveContractAddress(aliceAddress, 1, "aabbccdd", "contract-1");
  assert.ok(state.contracts[contractAddress]);
  const deployHash = hashTx(deploy);
  assert.ok(state.contractReceipts[deployHash]);
  assert.equal(state.contractReceipts[deployHash].type, "contract_deploy");
  assert.equal(state.contractReceipts[deployHash].contractAddress, contractAddress);
  assert.ok(state.contractEvents.find((e) => e.txHash === deployHash && e.name === "ContractDeployed"));

  const call = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 2,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "increment",
    args: [1],
    gasLimit: 200000,
    maxFeePerGas: 1n,
  });

  const callResult = applyBlock(state, [call], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(callResult.rejected.length, 0);
  assert.ok(state.contractStorage[contractAddress]);
  assert.ok(state.contractStorage[contractAddress].__lastCall);
  assert.equal(state.contractStorage[contractAddress].counter, "1");
  const callHash = hashTx(call);
  assert.ok(state.contractReceipts[callHash]);
  assert.equal(state.contractReceipts[callHash].type, "contract_call");
  assert.equal(state.contractReceipts[callHash].returnData, "1");
  assert.ok(state.contractEvents.find((e) => e.txHash === callHash && e.name === "ContractCalled"));
  assert.ok(state.contractEvents.find((e) => e.txHash === callHash && e.name === "CounterIncremented"));
});

test("qtx-v1 user-defined contract executes custom method program", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const signTx = (
    input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & {
      fee?: bigint;
      chainId?: string;
    },
  ): Transaction => {
    const unsignedTx: Transaction = {
      chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
      fee: 0n,
      timestamp: Date.now(),
      ...input,
      signerPublicKey: alice.publicKey,
      signature: "",
    };
    return {
      ...unsignedTx,
      signature: signPqMessage(alice.privateKey, transactionSigningPayload(unsignedTx)),
    };
  };

  const qtxV1Code = JSON.stringify({
    vm: "qtx-v1",
    methods: {
      setGreeting: [
        { op: "set", key: "greeting", arg: 0 },
        { op: "emit", name: "GreetingSet", arg: 0 },
        { op: "return", key: "greeting" },
      ],
      incrementBy: [
        { op: "add", key: "counter", arg: 0 },
        { op: "emit", name: "CounterIncreased", key: "counter" },
        { op: "return", key: "counter" },
      ],
      setGreetingViaValueArg: [
        { op: "set", key: "greeting_v2", value: { "$arg": 0 } },
        { op: "emit", name: "GreetingSetV2", data: { "$arg": 0 } },
        { op: "return", key: "greeting_v2" },
      ],
    },
  });

  const deploy = signTx({
    type: "contract_deploy",
    from: aliceAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractCode: qtxV1Code,
    gasLimit: 300000,
    maxFeePerGas: 1n,
    salt: "qtx-v1-user-program",
  });
  assert.equal(applyBlock(state, [deploy], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const contractAddress = deriveContractAddress(aliceAddress, 1, qtxV1Code, "qtx-v1-user-program");

  const setGreeting = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 2,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "setGreeting",
    args: ["hello quantix"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  assert.equal(applyBlock(state, [setGreeting], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const inc = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 3,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "incrementBy",
    args: ["7"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  assert.equal(applyBlock(state, [inc], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const setGreetingV2 = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 4,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "setGreetingViaValueArg",
    args: ["halo dari value.$arg"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  assert.equal(applyBlock(state, [setGreetingV2], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const setHash = hashTx(setGreeting);
  const incHash = hashTx(inc);
  const setV2Hash = hashTx(setGreetingV2);
  assert.equal(state.contractStorage[contractAddress].greeting, "hello quantix");
  assert.equal(state.contractStorage[contractAddress].counter, "7");
  assert.equal(state.contractStorage[contractAddress].greeting_v2, "halo dari value.$arg");
  assert.equal(state.contractReceipts[setHash].returnData, "hello quantix");
  assert.equal(state.contractReceipts[incHash].returnData, "7");
  assert.equal(state.contractReceipts[setV2Hash].returnData, "halo dari value.$arg");
  assert.ok(state.contractEvents.find((e) => e.txHash === setHash && e.name === "GreetingSet"));
  assert.ok(state.contractEvents.find((e) => e.txHash === incHash && e.name === "CounterIncreased"));
  assert.ok(state.contractEvents.find((e) => e.txHash === setV2Hash && e.name === "GreetingSetV2"));
});

test("native contract methods set/get/delete are deterministic", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const signTx = (
    input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & {
      fee?: bigint;
      chainId?: string;
    },
  ): Transaction => {
    const unsignedTx: Transaction = {
      chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
      fee: 0n,
      timestamp: Date.now(),
      ...input,
      signerPublicKey: alice.publicKey,
      signature: "",
    };
    return {
      ...unsignedTx,
      signature: signPqMessage(alice.privateKey, transactionSigningPayload(unsignedTx)),
    };
  };

  const contractCode = "aabbccdd";
  const deploy = signTx({
    type: "contract_deploy",
    from: aliceAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractCode,
    gasLimit: 200000,
    maxFeePerGas: 1n,
    salt: "runtime-methods",
  });
  const deployResult = applyBlock(state, [deploy], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(deployResult.rejected.length, 0);

  const contractAddress = deriveContractAddress(aliceAddress, 1, contractCode, "runtime-methods");

  const setTx = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 2,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "set",
    args: ["greeting", "hello"],
    gasLimit: 200000,
    maxFeePerGas: 1n,
  });
  const setResult = applyBlock(state, [setTx], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(setResult.rejected.length, 0);
  const setHash = hashTx(setTx);
  assert.equal(state.contractStorage[contractAddress].greeting, "hello");
  assert.equal(state.contractReceipts[setHash].returnData, "hello");

  const getTx = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 3,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "get",
    args: ["greeting"],
    gasLimit: 200000,
    maxFeePerGas: 1n,
  });
  const getResult = applyBlock(state, [getTx], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(getResult.rejected.length, 0);
  const getHash = hashTx(getTx);
  assert.equal(state.contractReceipts[getHash].returnData, "hello");

  const deleteTx = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 4,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "delete",
    args: ["greeting"],
    gasLimit: 200000,
    maxFeePerGas: 1n,
  });
  const deleteResult = applyBlock(state, [deleteTx], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(deleteResult.rejected.length, 0);
  const deleteHash = hashTx(deleteTx);
  assert.equal(state.contractReceipts[deleteHash].returnData, "1");
  assert.equal(state.contractStorage[contractAddress].greeting, undefined);

  assert.ok(state.contractEvents.find((e) => e.txHash === setHash && e.name === "StorageSet"));
  assert.ok(state.contractEvents.find((e) => e.txHash === getHash && e.name === "StorageRead"));
  assert.ok(state.contractEvents.find((e) => e.txHash === deleteHash && e.name === "StorageDeleted"));
});

test("native contract method transfer moves value from contract balance", () => {
  const alice = generatePqKeyPair();
  const bob = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const bobAddress = deriveAddressFromPublicKey(bob.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n, [bobAddress]: 0n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const signTx = (
    input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & {
      fee?: bigint;
      chainId?: string;
    },
  ): Transaction => {
    const unsignedTx: Transaction = {
      chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
      fee: 0n,
      timestamp: Date.now(),
      ...input,
      signerPublicKey: alice.publicKey,
      signature: "",
    };
    return {
      ...unsignedTx,
      signature: signPqMessage(alice.privateKey, transactionSigningPayload(unsignedTx)),
    };
  };

  const contractCode = "aabbccdd";
  const deploy = signTx({
    type: "contract_deploy",
    from: aliceAddress,
    nonce: 1,
    amount: 0n,
    value: 50n,
    contractCode,
    gasLimit: 200000,
    maxFeePerGas: 1n,
    salt: "runtime-transfer",
  });
  assert.equal(applyBlock(state, [deploy], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const contractAddress = deriveContractAddress(aliceAddress, 1, contractCode, "runtime-transfer");
  assert.equal(state.accounts[contractAddress].balance, 50n);

  const transfer = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 2,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "transfer",
    args: [bobAddress, "15"],
    gasLimit: 200000,
    maxFeePerGas: 1n,
  });
  const transferResult = applyBlock(state, [transfer], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(transferResult.rejected.length, 0);

  const transferHash = hashTx(transfer);
  assert.equal(state.contractReceipts[transferHash].returnData, "15");
  assert.equal(state.accounts[contractAddress].balance, 35n);
  assert.equal(state.accounts[bobAddress].balance, 15n);
  assert.ok(state.contractEvents.find((e) => e.txHash === transferHash && e.name === "ContractTransfer"));
});

test("native contract method batch_set writes multiple keys deterministically", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const signTx = (
    input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & {
      fee?: bigint;
      chainId?: string;
    },
  ): Transaction => {
    const unsignedTx: Transaction = {
      chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
      fee: 0n,
      timestamp: Date.now(),
      ...input,
      signerPublicKey: alice.publicKey,
      signature: "",
    };
    return {
      ...unsignedTx,
      signature: signPqMessage(alice.privateKey, transactionSigningPayload(unsignedTx)),
    };
  };

  const contractCode = "aabbccdd";
  const deploy = signTx({
    type: "contract_deploy",
    from: aliceAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractCode,
    gasLimit: 200000,
    maxFeePerGas: 1n,
    salt: "runtime-batch-set",
  });
  assert.equal(applyBlock(state, [deploy], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const contractAddress = deriveContractAddress(aliceAddress, 1, contractCode, "runtime-batch-set");

  const batchSet = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 2,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "batch_set",
    args: [[
      ["a", "1"],
      ["b", 2],
      ["c", { ok: true }],
      ["", "ignored"],
    ]],
    gasLimit: 200000,
    maxFeePerGas: 1n,
  });
  const batchResult = applyBlock(state, [batchSet], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(batchResult.rejected.length, 0);

  const batchHash = hashTx(batchSet);
  assert.equal(state.contractReceipts[batchHash].returnData, "3");
  assert.equal(state.contractStorage[contractAddress].a, "1");
  assert.equal(state.contractStorage[contractAddress].b, "2");
  assert.equal(state.contractStorage[contractAddress].c, '{"ok":true}');
  assert.equal(state.contractStorage[contractAddress][""], undefined);
  assert.ok(state.contractEvents.find((e) => e.txHash === batchHash && e.name === "StorageBatchSet"));
});

test("native token runtime supports ERC20-like transfer/approve/transferFrom flow", () => {
  const alice = generatePqKeyPair();
  const bob = generatePqKeyPair();
  const carol = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const bobAddress = deriveAddressFromPublicKey(bob.publicKey);
  const carolAddress = deriveAddressFromPublicKey(carol.publicKey);
  const state = createGenesisState({ [aliceAddress]: 2_000n, [bobAddress]: 200n, [carolAddress]: 200n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const keyByAddress = new Map<string, { publicKey: string; privateKey: string }>([
    [aliceAddress, alice],
    [bobAddress, bob],
    [carolAddress, carol],
  ]);

  const signTx = (
    input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & {
      fee?: bigint;
      chainId?: string;
    },
  ): Transaction => {
    const kp = keyByAddress.get(input.from);
    if (!kp) throw new Error(`missing keypair for ${input.from}`);
    const unsignedTx: Transaction = {
      chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
      fee: 0n,
      timestamp: Date.now(),
      ...input,
      signerPublicKey: kp.publicKey,
      signature: "",
    };
    return {
      ...unsignedTx,
      signature: signPqMessage(kp.privateKey, transactionSigningPayload(unsignedTx)),
    };
  };

  const code = "aabbccdd";
  const deploy = signTx({
    type: "contract_deploy",
    from: aliceAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractCode: code,
    gasLimit: 250000,
    maxFeePerGas: 1n,
    salt: "token-flow",
  });
  assert.equal(applyBlock(state, [deploy], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const contractAddress = deriveContractAddress(aliceAddress, 1, code, "token-flow");

  const initToken = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 2,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_init",
    args: [{ name: "Quantix USD", symbol: "QUSD", decimals: 6, initialSupply: "1000", owner: aliceAddress }],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  assert.equal(applyBlock(state, [initToken], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const transfer = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 3,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_transfer",
    args: [bobAddress, "200"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  assert.equal(applyBlock(state, [transfer], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const approve = signTx({
    type: "contract_call",
    from: bobAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_approve",
    args: [carolAddress, "50"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  assert.equal(applyBlock(state, [approve], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const transferFrom = signTx({
    type: "contract_call",
    from: carolAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_transfer_from",
    args: [bobAddress, carolAddress, "20"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  const transferFromResult = applyBlock(state, [transferFrom], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(transferFromResult.rejected.length, 0);

  const storage = state.contractStorage[contractAddress];
  assert.equal(storage["token:name"], "Quantix USD");
  assert.equal(storage["token:symbol"], "QUSD");
  assert.equal(storage["token:decimals"], "6");
  assert.equal(storage[`token:bal:${aliceAddress}`], "800");
  assert.equal(storage[`token:bal:${bobAddress}`], "180");
  assert.equal(storage[`token:bal:${carolAddress}`], "20");
  assert.equal(storage[`token:allow:${bobAddress}:${carolAddress}`], "30");

  const tfHash = hashTx(transferFrom);
  assert.equal(state.contractReceipts[tfHash].returnData, "20");
  assert.ok(state.contractEvents.find((e) => e.txHash === tfHash && e.name === "Transfer"));
  assert.ok(state.contractEvents.find((e) => e.txHash === hashTx(approve) && e.name === "Approval"));
});

test("native token runtime supports owner-only customization via token_config", () => {
  const alice = generatePqKeyPair();
  const bob = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const bobAddress = deriveAddressFromPublicKey(bob.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n, [bobAddress]: 1_000n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const keyByAddress = new Map<string, { publicKey: string; privateKey: string }>([
    [aliceAddress, alice],
    [bobAddress, bob],
  ]);

  const signTx = (
    input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & {
      fee?: bigint;
      chainId?: string;
    },
  ): Transaction => {
    const kp = keyByAddress.get(input.from);
    if (!kp) throw new Error(`missing keypair for ${input.from}`);
    const unsignedTx: Transaction = {
      chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
      fee: 0n,
      timestamp: Date.now(),
      ...input,
      signerPublicKey: kp.publicKey,
      signature: "",
    };
    return {
      ...unsignedTx,
      signature: signPqMessage(kp.privateKey, transactionSigningPayload(unsignedTx)),
    };
  };

  const code = "aabbccdd";
  const deploy = signTx({
    type: "contract_deploy",
    from: aliceAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractCode: code,
    gasLimit: 250000,
    maxFeePerGas: 1n,
    salt: "token-config",
  });
  assert.equal(applyBlock(state, [deploy], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const contractAddress = deriveContractAddress(aliceAddress, 1, code, "token-config");
  const initToken = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 2,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_init",
    args: ["Quantix Points", "QPTS", 8, "0", aliceAddress],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  assert.equal(applyBlock(state, [initToken], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const bobConfig = signTx({
    type: "contract_call",
    from: bobAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_config",
    args: ["logoURI", "https://example.invalid/logo.png"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  const bobConfigResult = applyBlock(state, [bobConfig], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(bobConfigResult.rejected.length, 0);
  assert.equal(state.contractStorage[contractAddress]["token:meta:logoURI"], undefined);
  assert.equal(state.contractReceipts[hashTx(bobConfig)].returnData, "0");

  const aliceConfig = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 3,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_config",
    args: ["logoURI", "https://example.invalid/logo.png"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  const aliceConfigResult = applyBlock(state, [aliceConfig], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(aliceConfigResult.rejected.length, 0);
  assert.equal(state.contractStorage[contractAddress]["token:meta:logoURI"], "https://example.invalid/logo.png");
  assert.equal(state.contractReceipts[hashTx(aliceConfig)].returnData, "https://example.invalid/logo.png");

  const transferOwnership = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 4,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_transfer_ownership",
    args: [bobAddress],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  const transferOwnershipResult = applyBlock(state, [transferOwnership], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(transferOwnershipResult.rejected.length, 0);
  assert.equal(state.contractStorage[contractAddress]["token:owner"], bobAddress);
  assert.ok(state.contractEvents.find((e) => e.txHash === hashTx(transferOwnership) && e.name === "OwnershipTransferred"));

  const oldOwnerConfig = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 5,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_config",
    args: ["website", "https://old-owner.invalid"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  const oldOwnerConfigResult = applyBlock(state, [oldOwnerConfig], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(oldOwnerConfigResult.rejected.length, 0);
  assert.equal(state.contractStorage[contractAddress]["token:meta:website"], undefined);
  assert.equal(state.contractReceipts[hashTx(oldOwnerConfig)].returnData, "0");

  const newOwnerConfig = signTx({
    type: "contract_call",
    from: bobAddress,
    nonce: 2,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "token_config",
    args: ["website", "https://new-owner.invalid"],
    gasLimit: 250000,
    maxFeePerGas: 1n,
  });
  const newOwnerConfigResult = applyBlock(state, [newOwnerConfig], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(newOwnerConfigResult.rejected.length, 0);
  assert.equal(state.contractStorage[contractAddress]["token:meta:website"], "https://new-owner.invalid");
  assert.equal(state.contractReceipts[hashTx(newOwnerConfig)].returnData, "https://new-owner.invalid");
});

test("rejected contract tx records failed receipt and failure event", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const unsignedTx: Transaction = {
    type: "contract_call",
    chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
    from: aliceAddress,
    nonce: 1,
    timestamp: Date.now(),
    amount: 0n,
    fee: 0n,
    signerPublicKey: alice.publicKey,
    signature: "",
    contractAddress: "qtxContractdoesnotexist",
    method: "ping",
    args: [],
    gasLimit: 100_000,
    maxFeePerGas: 1n,
    value: 0n,
  };
  const tx: Transaction = {
    ...unsignedTx,
    signature: signPqMessage(alice.privateKey, transactionSigningPayload(unsignedTx)),
  };

  const result = applyBlock(state, [tx], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);

  const txHash = hashTx(tx);
  assert.ok(state.contractReceipts[txHash]);
  assert.equal(state.contractReceipts[txHash].success, false);
  assert.match(state.contractReceipts[txHash].error ?? "", /contract not found/);
  assert.ok(state.contractEvents.find((e) => e.txHash === txHash && e.name === "ContractExecutionFailed"));
});

test("contract_deploy out-of-gas is rejected and recorded", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const unsignedTx: Transaction = {
    type: "contract_deploy",
    chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
    from: aliceAddress,
    nonce: 1,
    timestamp: Date.now(),
    amount: 0n,
    fee: 0n,
    signerPublicKey: alice.publicKey,
    signature: "",
    contractCode: "aabbccdd",
    gasLimit: 10,
    maxFeePerGas: 1n,
    value: 0n,
    salt: "og-test",
  };
  const tx: Transaction = {
    ...unsignedTx,
    signature: signPqMessage(alice.privateKey, transactionSigningPayload(unsignedTx)),
  };

  const result = applyBlock(state, [tx], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /out of gas/);

  const txHash = hashTx(tx);
  assert.equal(state.contractReceipts[txHash].success, false);
  assert.match(state.contractReceipts[txHash].error ?? "", /out of gas/);
});

test("qtx-v1 deploy rejects unsupported vm ops", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const invalidVm = JSON.stringify({
    vm: "qtx-v1",
    methods: {
      bad: [{ op: "jump" }],
    },
  });

  const unsignedTx: Transaction = {
    type: "contract_deploy",
    chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
    from: aliceAddress,
    nonce: 1,
    timestamp: Date.now(),
    amount: 0n,
    fee: 0n,
    signerPublicKey: alice.publicKey,
    signature: "",
    contractCode: invalidVm,
    gasLimit: 200_000,
    maxFeePerGas: 1n,
    value: 0n,
    salt: "invalid-vm-op",
  };
  const tx: Transaction = {
    ...unsignedTx,
    signature: signPqMessage(alice.privateKey, transactionSigningPayload(unsignedTx)),
  };

  const result = applyBlock(state, [tx], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /unsupported op/i);
});

test("qtx-v1 call enforces instruction-based gas requirement", () => {
  const alice = generatePqKeyPair();
  const aliceAddress = deriveAddressFromPublicKey(alice.publicKey);
  const state = createGenesisState({ [aliceAddress]: 1_000n });

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature)
      ? true
      : "invalid pq signature";
  };

  const signTx = (
    input: Omit<Transaction, "signerPublicKey" | "signature" | "fee" | "timestamp" | "chainId"> & {
      fee?: bigint;
      chainId?: string;
    },
  ): Transaction => {
    const unsignedTx: Transaction = {
      chainId: DEFAULT_PROTOCOL_CONFIG.chainId,
      fee: 0n,
      timestamp: Date.now(),
      ...input,
      signerPublicKey: alice.publicKey,
      signature: "",
    };
    return {
      ...unsignedTx,
      signature: signPqMessage(alice.privateKey, transactionSigningPayload(unsignedTx)),
    };
  };

  const methodProgram = Array.from({ length: 40 }, (_, i) =>
    i === 39 ? { op: "return", value: "ok" } : { op: "set", key: `k${i}`, value: i },
  );
  const qtxV1Code = JSON.stringify({
    vm: "qtx-v1",
    methods: {
      heavy: methodProgram,
    },
  });

  const deploy = signTx({
    type: "contract_deploy",
    from: aliceAddress,
    nonce: 1,
    amount: 0n,
    value: 0n,
    contractCode: qtxV1Code,
    gasLimit: 300000,
    maxFeePerGas: 1n,
    salt: "heavy-gas",
  });
  assert.equal(applyBlock(state, [deploy], DEFAULT_PROTOCOL_CONFIG, { verifySignature }).rejected.length, 0);

  const contractAddress = deriveContractAddress(aliceAddress, 1, qtxV1Code, "heavy-gas");
  const lowGasCall = signTx({
    type: "contract_call",
    from: aliceAddress,
    nonce: 2,
    amount: 0n,
    value: 0n,
    contractAddress,
    method: "heavy",
    args: [],
    gasLimit: 50_000,
    maxFeePerGas: 1n,
  });

  const lowGasResult = applyBlock(state, [lowGasCall], DEFAULT_PROTOCOL_CONFIG, { verifySignature });
  assert.equal(lowGasResult.accepted.length, 0);
  assert.equal(lowGasResult.rejected.length, 1);
  assert.match(lowGasResult.rejected[0].reason, /out of gas/i);
});
