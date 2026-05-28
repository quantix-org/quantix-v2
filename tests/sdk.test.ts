/**
 * SDK unit tests — no running node required.
 *
 * Tests cover:
 *   - Key generation and address derivation
 *   - Transaction builder output shape + signing
 *   - Signature round-trip (build then verify via protocol)
 *   - serializeTx round-trip through parseRpcTransactionStrict
 *   - RpcError class structure
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  generateKeyPair,
  deriveAddress,
  buildTransferTx,
  buildStakeTx,
  buildUnstakeTx,
  buildValidatorRegisterTx,
  RpcError,
} from "@quantix/sdk";
import { verifyPqSignature } from "@quantix/crypto";
import { transactionSigningPayload } from "@quantix/protocol";
import { parseRpcTransactionStrict } from "../apps/node/src/tx-policy.js";

// ─── Shared fixtures ─────────────────────────────────────────────────────────

function makeAccount() {
  const kp = generateKeyPair();
  const address = deriveAddress(kp.publicKey);
  return { ...kp, address };
}

// ─── Key management ───────────────────────────────────────────────────────────

test("generateKeyPair returns a non-empty key pair", () => {
  const kp = generateKeyPair();
  assert.ok(kp.publicKey.length > 0, "publicKey should be non-empty");
  assert.ok(kp.privateKey.length > 0, "privateKey should be non-empty");
});

test("deriveAddress returns a qtx1-prefixed address", () => {
  const kp = generateKeyPair();
  const addr = deriveAddress(kp.publicKey);
  assert.ok(addr.startsWith("qtx1"), `expected qtx1 prefix, got ${addr}`);
});

test("deriveAddress is deterministic", () => {
  const kp = generateKeyPair();
  assert.strictEqual(deriveAddress(kp.publicKey), deriveAddress(kp.publicKey));
});

// ─── buildTransferTx ─────────────────────────────────────────────────────────

test("buildTransferTx produces a correctly shaped transaction", () => {
  const sender = makeAccount();
  const recipient = makeAccount();

  const tx = buildTransferTx({
    from: sender.address,
    to: recipient.address,
    amount: 100n,
    nonce: 1,
    fee: 1n,
    signerPublicKey: sender.publicKey,
    privateKey: sender.privateKey,
  });

  assert.strictEqual(tx.type, "transfer");
  assert.strictEqual(tx.from, sender.address);
  assert.strictEqual(tx.to, recipient.address);
  assert.strictEqual(tx.amount, 100n);
  assert.strictEqual(tx.fee, 1n);
  assert.strictEqual(tx.nonce, 1);
  assert.ok(tx.signature.length > 0, "signature should be non-empty");
});

test("buildTransferTx defaults fee to 0n when omitted", () => {
  const sender = makeAccount();
  const recipient = makeAccount();

  const tx = buildTransferTx({
    from: sender.address,
    to: recipient.address,
    amount: 50n,
    nonce: 1,
    signerPublicKey: sender.publicKey,
    privateKey: sender.privateKey,
  });

  assert.strictEqual(tx.fee, 0n);
});

test("buildTransferTx signature is valid", () => {
  const sender = makeAccount();
  const recipient = makeAccount();

  const tx = buildTransferTx({
    from: sender.address,
    to: recipient.address,
    amount: 100n,
    nonce: 1,
    signerPublicKey: sender.publicKey,
    privateKey: sender.privateKey,
  });

  const payload = transactionSigningPayload(tx);
  const ok = verifyPqSignature(sender.publicKey, payload, tx.signature);
  assert.ok(ok, "signature should verify against the signing payload");
});

// ─── buildStakeTx ────────────────────────────────────────────────────────────

test("buildStakeTx produces a stake transaction with valid signature", () => {
  const acc = makeAccount();

  const tx = buildStakeTx({
    from: acc.address,
    amount: 1000n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
  });

  assert.strictEqual(tx.type, "stake");
  assert.strictEqual(tx.to, undefined);
  assert.strictEqual(tx.validatorId, undefined);

  const ok = verifyPqSignature(acc.publicKey, transactionSigningPayload(tx), tx.signature);
  assert.ok(ok, "stake tx signature should verify");
});

// ─── buildUnstakeTx ──────────────────────────────────────────────────────────

test("buildUnstakeTx produces an unstake transaction with valid signature", () => {
  const acc = makeAccount();

  const tx = buildUnstakeTx({
    from: acc.address,
    amount: 500n,
    nonce: 2,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
  });

  assert.strictEqual(tx.type, "unstake");
  const ok = verifyPqSignature(acc.publicKey, transactionSigningPayload(tx), tx.signature);
  assert.ok(ok, "unstake tx signature should verify");
});

// ─── buildValidatorRegisterTx ────────────────────────────────────────────────

test("buildValidatorRegisterTx produces a validator_register tx with valid signature", () => {
  const acc = makeAccount();

  const tx = buildValidatorRegisterTx({
    from: acc.address,
    validatorId: "validator-99",
    amount: 5000n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
  });

  assert.strictEqual(tx.type, "validator_register");
  assert.strictEqual(tx.validatorId, "validator-99");
  assert.strictEqual(tx.to, undefined);

  const ok = verifyPqSignature(acc.publicKey, transactionSigningPayload(tx), tx.signature);
  assert.ok(ok, "validator_register tx signature should verify");
});

// ─── Wire format round-trip ───────────────────────────────────────────────────
//
// Simulate what happens when the node receives a submitted transaction:
// SDK builds a Transaction, the SDK serializeTx() converts bigints to strings
// (done internally before submitTx()), and the node calls parseRpcTransactionStrict().

function serializeTxForWire(tx: import("@quantix/protocol").Transaction): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    signerPublicKey: tx.signerPublicKey,
    signature: tx.signature,
  };
  if (tx.to !== undefined) out.to = tx.to;
  if (tx.validatorId !== undefined) out.validatorId = tx.validatorId;
  return out;
}

test("transfer tx wire format parses successfully on the node side", () => {
  const sender = makeAccount();
  const recipient = makeAccount();

  const tx = buildTransferTx({
    from: sender.address,
    to: recipient.address,
    amount: 200n,
    nonce: 1,
    fee: 2n,
    signerPublicKey: sender.publicKey,
    privateKey: sender.privateKey,
  });

  const wire = serializeTxForWire(tx);
  const parsed = parseRpcTransactionStrict(wire);

  assert.strictEqual(parsed.type, "transfer");
  assert.strictEqual(parsed.amount, 200n);
  assert.strictEqual(parsed.fee, 2n);
  assert.strictEqual(parsed.to, recipient.address);
});

test("validator_register tx wire format parses successfully on the node side", () => {
  const acc = makeAccount();

  const tx = buildValidatorRegisterTx({
    from: acc.address,
    validatorId: "val-abc",
    amount: 1000n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
  });

  const wire = serializeTxForWire(tx);
  const parsed = parseRpcTransactionStrict(wire);

  assert.strictEqual(parsed.type, "validator_register");
  assert.strictEqual(parsed.validatorId, "val-abc");
  assert.strictEqual(parsed.amount, 1000n);
});

// ─── RpcError ────────────────────────────────────────────────────────────────

test("RpcError carries code and data fields", () => {
  const err = new RpcError("nonce stale", -32010, { nonce: 3 });
  assert.ok(err instanceof Error);
  assert.strictEqual(err.name, "RpcError");
  assert.strictEqual(err.message, "nonce stale");
  assert.strictEqual(err.code, -32010);
  assert.deepStrictEqual(err.data, { nonce: 3 });
});
