import test from "node:test";
import assert from "node:assert/strict";
import { createGenesisState, transactionSigningPayload, type Transaction } from "@quantix/protocol";
import { deriveAddressFromPublicKey, generatePqKeyPair, signPqMessage, verifyPqSignature } from "@quantix/crypto";
import { enqueueValidatedTx, getNextExpectedNonce, parseRpcTransactionStrict } from "../apps/node/src/tx-policy.js";
import { RpcError, RpcErrorCode } from "../apps/node/src/rpc-errors.js";

function createSignedTransfer(fromKey: { privateKey: string; publicKey: string }, from: string, to: string, nonce: number): Transaction {
  const unsignedTx: Transaction = {
    type: "transfer",
    chainId: "quantix-devnet",
    from,
    to,
    nonce,
    timestamp: Date.now(),
    amount: 10n,
    fee: 0n,
    signerPublicKey: fromKey.publicKey,
    signature: "",
  };

  return {
    ...unsignedTx,
    signature: signPqMessage(fromKey.privateKey, transactionSigningPayload(unsignedTx)),
  };
}

test("parseRpcTransactionStrict rejects invalid shape", () => {
  assert.throws(
    () =>
      parseRpcTransactionStrict({
        type: "transfer",
        chainId: "quantix-devnet",
        from: "not-qtx",
        to: "qtx1dest",
        nonce: 1,
        amount: "10",
        signerPublicKey: "aa",
        signature: "bb",
      }),
    /qtx address/,
  );

  assert.throws(
    () =>
      parseRpcTransactionStrict({
        type: "stake",
        chainId: "quantix-devnet",
        from: "qtx1abc",
        nonce: 1,
        amount: "0",
        signerPublicKey: "aa",
        signature: "bb",
      }),
    /field 'amount' must be > 0/,
  );

  assert.throws(
    () =>
      parseRpcTransactionStrict({
        type: "transfer",
        chainId: "quantix-devnet",
        from: "qtx1abc",
        to: "qtxContractdeadbeef",
        nonce: 1,
        amount: "10",
        fee: "0",
        signerPublicKey: "aa",
        signature: "bb",
      }),
    /account address/,
  );
});

test("parseRpcTransactionStrict emits INVALID_PARAMS code", () => {
  try {
    parseRpcTransactionStrict({
      type: "transfer",
      from: "not-qtx",
      to: "qtx1dest",
      nonce: 1,
      amount: "10",
      signerPublicKey: "aa",
      signature: "bb",
    });
    assert.fail("expected RpcError");
  } catch (error) {
    assert.ok(error instanceof RpcError);
    assert.equal(error.code, RpcErrorCode.INVALID_PARAMS);
    assert.equal((error.data as { category?: string }).category, "schema");
  }
});

test("enqueueValidatedTx enforces sequential nonce and conflict prevention", () => {
  const aliceKeys = generatePqKeyPair();
  const bobKeys = generatePqKeyPair();
  const alice = deriveAddressFromPublicKey(aliceKeys.publicKey);
  const bob = deriveAddressFromPublicKey(bobKeys.publicKey);

  const state = createGenesisState({ [alice]: 100n, [bob]: 0n });
  const mempool: Transaction[] = [];

  const verifySignature = (tx: Transaction, payload: string): true | string => {
    if (deriveAddressFromPublicKey(tx.signerPublicKey) !== tx.from) {
      return "signer address mismatch";
    }
    return verifyPqSignature(tx.signerPublicKey, payload, tx.signature) ? true : "invalid pq signature";
  };

  const tx1 = createSignedTransfer(aliceKeys, alice, bob, 1);
  enqueueValidatedTx(state, mempool, tx1, verifySignature, "quantix-devnet");
  assert.equal(mempool.length, 1);
  assert.equal(getNextExpectedNonce(state, mempool, alice), 2);

  const duplicateNonce = createSignedTransfer(aliceKeys, alice, bob, 1);
  try {
    enqueueValidatedTx(state, mempool, duplicateNonce, verifySignature, "quantix-devnet");
    assert.fail("expected conflict RpcError");
  } catch (error) {
    assert.ok(error instanceof RpcError);
    assert.equal(error.code, RpcErrorCode.NONCE_CONFLICT);
  }

  const gapNonce = createSignedTransfer(aliceKeys, alice, bob, 3);
  try {
    enqueueValidatedTx(state, mempool, gapNonce, verifySignature, "quantix-devnet");
    assert.fail("expected sequence RpcError");
  } catch (error) {
    assert.ok(error instanceof RpcError);
    assert.equal(error.code, RpcErrorCode.NONCE_SEQUENCE);
  }

  const tx2 = createSignedTransfer(aliceKeys, alice, bob, 2);
  enqueueValidatedTx(state, mempool, tx2, verifySignature, "quantix-devnet");
  assert.equal(mempool.length, 2);
});

test("parseRpcTransactionStrict accepts contract_call with qtxContract prefix", () => {
  const parsed = parseRpcTransactionStrict({
    type: "contract_call",
    chainId: "quantix-devnet",
    from: "qtx1abc",
    nonce: 1,
    amount: "1",
    fee: "0",
    signerPublicKey: "aa",
    signature: "bb",
    contractAddress: "qtxContractc0ffee",
    method: "increment",
    args: [1, "two"],
    gasLimit: 200000,
    maxFeePerGas: "10",
    value: "0",
  });

  assert.equal(parsed.type, "contract_call");
  assert.equal(parsed.contractAddress, "qtxContractc0ffee");
  assert.equal(parsed.method, "increment");
  assert.deepEqual(parsed.args, [1, "two"]);
  assert.equal(parsed.gasLimit, 200000);
  assert.equal(parsed.maxFeePerGas, 10n);
});

test("parseRpcTransactionStrict accepts contract_deploy with contract fields", () => {
  const parsed = parseRpcTransactionStrict({
    type: "contract_deploy",
    chainId: "quantix-devnet",
    from: "qtx1abc",
    nonce: 1,
    amount: "1",
    fee: "0",
    signerPublicKey: "aa",
    signature: "bb",
    contractCode: "aabbcc",
    gasLimit: 300000,
    maxFeePerGas: "5",
    value: "0",
    salt: "tenant-1",
  });

  assert.equal(parsed.type, "contract_deploy");
  assert.equal(parsed.contractCode, "aabbcc");
  assert.equal(parsed.gasLimit, 300000);
  assert.equal(parsed.maxFeePerGas, 5n);
  assert.equal(parsed.salt, "tenant-1");
});
