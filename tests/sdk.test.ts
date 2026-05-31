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
  buildContractDeployTx,
  buildQtxVmV1DeployTx,
  buildContractCallTx,
  buildQtxVmV1CallTx,
  callQtxVmV1Decoded,
  createQtxVmV1Contract,
  decodeContractReturnData,
  decodeUtf8Hex,
  encodeQtxVmV1ContractHex,
  encodeUtf8Hex,
  RpcError,
  stringifyQtxVmV1Contract,
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
    chainId: "quantix-devnet",
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
    chainId: "quantix-devnet",
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
    chainId: "quantix-devnet",
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
    chainId: "quantix-devnet",
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
    chainId: "quantix-devnet",
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
    chainId: "quantix-devnet",
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

// ─── buildContractDeployTx / buildContractCallTx ────────────────────────────

test("buildContractDeployTx produces a contract_deploy tx with valid signature", () => {
  const acc = makeAccount();

  const tx = buildContractDeployTx({
    chainId: "quantix-devnet",
    from: acc.address,
    amount: 0n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
    contractCode: "aabbccdd",
    gasLimit: 200000,
    maxFeePerGas: 2n,
    value: 0n,
    salt: "sdk-deploy",
  });

  assert.strictEqual(tx.type, "contract_deploy");
  assert.strictEqual(tx.contractCode, "aabbccdd");
  assert.strictEqual(tx.gasLimit, 200000);
  assert.strictEqual(tx.maxFeePerGas, 2n);
  assert.strictEqual(tx.salt, "sdk-deploy");

  const ok = verifyPqSignature(acc.publicKey, transactionSigningPayload(tx), tx.signature);
  assert.ok(ok, "contract_deploy tx signature should verify");
});

test("buildContractCallTx produces a contract_call tx with valid signature", () => {
  const acc = makeAccount();

  const tx = buildContractCallTx({
    chainId: "quantix-devnet",
    from: acc.address,
    amount: 0n,
    nonce: 2,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
    contractAddress: "qtxContract1234567890abcdef",
    method: "increment",
    args: [1, "x"],
    gasLimit: 150000,
    maxFeePerGas: 1n,
    value: 0n,
  });

  assert.strictEqual(tx.type, "contract_call");
  assert.strictEqual(tx.contractAddress, "qtxContract1234567890abcdef");
  assert.strictEqual(tx.method, "increment");
  assert.deepStrictEqual(tx.args, [1, "x"]);
  assert.strictEqual(tx.gasLimit, 150000);

  const ok = verifyPqSignature(acc.publicKey, transactionSigningPayload(tx), tx.signature);
  assert.ok(ok, "contract_call tx signature should verify");
});

// ─── Wire format round-trip ───────────────────────────────────────────────────
//
// Simulate what happens when the node receives a submitted transaction:
// SDK builds a Transaction, the SDK serializeTx() converts bigints to strings
// (done internally before submitTx()), and the node calls parseRpcTransactionStrict().

function serializeTxForWire(tx: import("@quantix/protocol").Transaction): Record<string, unknown> {
  const out: Record<string, unknown> = {
    chainId: tx.chainId,
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
  if (tx.contractAddress !== undefined) out.contractAddress = tx.contractAddress;
  if (tx.contractCode !== undefined) out.contractCode = tx.contractCode;
  if (tx.method !== undefined) out.method = tx.method;
  if (tx.args !== undefined) out.args = tx.args;
  if (tx.gasLimit !== undefined) out.gasLimit = tx.gasLimit;
  if (tx.maxFeePerGas !== undefined) out.maxFeePerGas = tx.maxFeePerGas.toString();
  if (tx.value !== undefined) out.value = tx.value.toString();
  if (tx.salt !== undefined) out.salt = tx.salt;
  return out;
}

test("transfer tx wire format parses successfully on the node side", () => {
  const sender = makeAccount();
  const recipient = makeAccount();

  const tx = buildTransferTx({
    chainId: "quantix-devnet",
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
    chainId: "quantix-devnet",
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

test("contract_deploy tx wire format parses successfully on the node side", () => {
  const acc = makeAccount();
  const tx = buildContractDeployTx({
    chainId: "quantix-devnet",
    from: acc.address,
    amount: 0n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
    contractCode: "aabbccdd",
    gasLimit: 200000,
    maxFeePerGas: 2n,
    value: 0n,
    salt: "sdk-deploy",
  });

  const parsed = parseRpcTransactionStrict(serializeTxForWire(tx));
  assert.strictEqual(parsed.type, "contract_deploy");
  assert.strictEqual(parsed.contractCode, "aabbccdd");
  assert.strictEqual(parsed.gasLimit, 200000);
  assert.strictEqual(parsed.maxFeePerGas, 2n);
  assert.strictEqual(parsed.value, 0n);
});

test("contract_call tx wire format parses successfully on the node side", () => {
  const acc = makeAccount();
  const tx = buildContractCallTx({
    chainId: "quantix-devnet",
    from: acc.address,
    amount: 0n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
    contractAddress: "qtxContract1234567890abcdef",
    method: "setValue",
    args: [42],
    gasLimit: 150000,
    maxFeePerGas: 1n,
    value: 0n,
  });

  const parsed = parseRpcTransactionStrict(serializeTxForWire(tx));
  assert.strictEqual(parsed.type, "contract_call");
  assert.strictEqual(parsed.contractAddress, "qtxContract1234567890abcdef");
  assert.strictEqual(parsed.method, "setValue");
  assert.deepStrictEqual(parsed.args, [42]);
  assert.strictEqual(parsed.gasLimit, 150000);
});

test("qtx-v1 SDK helpers build canonical JSON payload", () => {
  const contract = createQtxVmV1Contract({
    setFromArg: [
      { op: "set", key: "value", arg: 0 },
      { op: "return", value: "ok" },
    ],
    increment: [
      { op: "add", key: "count", value: 1 },
      { op: "return", value: { ok: true } },
    ],
  });

  assert.deepStrictEqual(contract, {
    vm: "qtx-v1",
    methods: {
      setFromArg: [
        { op: "set", key: "value", arg: 0 },
        { op: "return", value: "ok" },
      ],
      increment: [
        { op: "add", key: "count", value: 1 },
        { op: "return", value: { ok: true } },
      ],
    },
  });

  assert.strictEqual(
    stringifyQtxVmV1Contract(contract),
    '{"vm":"qtx-v1","methods":{"setFromArg":[{"op":"set","key":"value","arg":0},{"op":"return","value":"ok"}],"increment":[{"op":"add","key":"count","value":1},{"op":"return","value":{"ok":true}}]}}',
  );
});

test("qtx-v1 SDK helpers hex-encode payloads for RPC deploys", () => {
  const hex = encodeQtxVmV1ContractHex({
    hello: [{ op: "return", value: "world" }],
  });

  assert.match(hex, /^[0-9a-f]+$/);
  assert.deepStrictEqual(JSON.parse(decodeUtf8Hex(hex)), {
    vm: "qtx-v1",
    methods: {
      hello: [{ op: "return", value: "world" }],
    },
  });
});

test("buildContractDeployTx accepts qtx-v1 hex payloads generated by SDK helpers", () => {
  const acc = makeAccount();
  const contractCode = encodeQtxVmV1ContractHex({
    setValue: [
      { op: "set", key: "value", value: { "$arg": 0 } },
      { op: "return", value: "ok" },
    ],
  });

  const tx = buildContractDeployTx({
    chainId: "quantix-devnet",
    from: acc.address,
    amount: 0n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
    contractCode,
    gasLimit: 200000,
    maxFeePerGas: 2n,
    value: 0n,
    salt: "sdk-vm-deploy",
  });

  const parsed = parseRpcTransactionStrict(serializeTxForWire(tx));
  assert.strictEqual(parsed.contractCode, contractCode);
  assert.deepStrictEqual(JSON.parse(decodeUtf8Hex(parsed.contractCode ?? "")), {
    vm: "qtx-v1",
    methods: {
      setValue: [
        { op: "set", key: "value", value: { "$arg": 0 } },
        { op: "return", value: "ok" },
      ],
    },
  });
});

test("buildQtxVmV1DeployTx defaults to RPC-safe hex encoding", () => {
  const acc = makeAccount();
  const tx = buildQtxVmV1DeployTx({
    chainId: "quantix-devnet",
    from: acc.address,
    amount: 0n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
    gasLimit: 220000,
    maxFeePerGas: 1n,
    value: 0n,
    salt: "sdk-vm-helper-hex",
    contract: {
      setValue: [
        { op: "set", key: "value", arg: 0 },
        { op: "return", value: "ok" },
      ],
    },
  });

  const parsed = parseRpcTransactionStrict(serializeTxForWire(tx));
  assert.ok(parsed.contractCode);
  assert.match(parsed.contractCode!, /^[0-9a-f]+$/);
  assert.deepStrictEqual(JSON.parse(decodeUtf8Hex(parsed.contractCode!)), {
    vm: "qtx-v1",
    methods: {
      setValue: [
        { op: "set", key: "value", arg: 0 },
        { op: "return", value: "ok" },
      ],
    },
  });
});

test("buildQtxVmV1DeployTx supports raw JSON encoding when requested", () => {
  const acc = makeAccount();
  const tx = buildQtxVmV1DeployTx({
    chainId: "quantix-devnet",
    from: acc.address,
    amount: 0n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
    gasLimit: 220000,
    maxFeePerGas: 1n,
    value: 0n,
    salt: "sdk-vm-helper-json",
    encoding: "json",
    contract: {
      echo: [{ op: "return", value: "ok" }],
    },
  });

  assert.ok(tx.contractCode);
  assert.strictEqual(tx.contractCode!, '{"vm":"qtx-v1","methods":{"echo":[{"op":"return","value":"ok"}]}}');
});

test("buildQtxVmV1CallTx forwards method and args", () => {
  const acc = makeAccount();
  const tx = buildQtxVmV1CallTx({
    chainId: "quantix-devnet",
    from: acc.address,
    amount: 0n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
    contractAddress: "qtxContract1234567890abcdef",
    method: "setValue",
    args: [42],
    gasLimit: 150000,
    maxFeePerGas: 1n,
    value: 0n,
  });

  const parsed = parseRpcTransactionStrict(serializeTxForWire(tx));
  assert.strictEqual(parsed.type, "contract_call");
  assert.strictEqual(parsed.method, "setValue");
  assert.deepStrictEqual(parsed.args, [42]);
  assert.strictEqual(parsed.contractAddress, "qtxContract1234567890abcdef");
});

test("buildQtxVmV1CallTx defaults args to empty array", () => {
  const acc = makeAccount();
  const tx = buildQtxVmV1CallTx({
    chainId: "quantix-devnet",
    from: acc.address,
    amount: 0n,
    nonce: 1,
    signerPublicKey: acc.publicKey,
    privateKey: acc.privateKey,
    contractAddress: "qtxContract1234567890abcdef",
    method: "ping",
    gasLimit: 120000,
    maxFeePerGas: 1n,
    value: 0n,
  });

  const parsed = parseRpcTransactionStrict(serializeTxForWire(tx));
  assert.deepStrictEqual(parsed.args, []);
  assert.strictEqual(parsed.method, "ping");
});

test("callQtxVmV1Decoded builds qtx_call payload and decodes returnData", async () => {
  const acc = makeAccount();
  const originalFetch = globalThis.fetch;
  let capturedBody = "";

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          success: true,
          contractAddress: "qtxContract1234567890abcdef",
          receipt: {
            txHash: "mock-hash",
            type: "contract_call",
            contractAddress: "qtxContract1234567890abcdef",
            success: true,
            gasUsed: 12345,
            blockHeight: 77,
            returnData: "42",
          },
          storage: { value: "42" },
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const result = await callQtxVmV1Decoded("http://localhost:7330/rpc", {
      chainId: "quantix-devnet",
      from: acc.address,
      amount: 0n,
      nonce: 1,
      signerPublicKey: acc.publicKey,
      privateKey: acc.privateKey,
      contractAddress: "qtxContract1234567890abcdef",
      method: "getValue",
      gasLimit: 150000,
      maxFeePerGas: 1n,
      value: 0n,
    });

    const rpcPayload = JSON.parse(capturedBody) as {
      method: string;
      params: Array<Record<string, unknown>>;
    };

    assert.strictEqual(rpcPayload.method, "qtx_call");
    assert.strictEqual(rpcPayload.params[0].type, "contract_call");
    assert.strictEqual(rpcPayload.params[0].method, "getValue");
    assert.deepStrictEqual(rpcPayload.params[0].args, []);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.decodedReturnData, 42n);
    assert.deepStrictEqual(result.storage, { value: "42" });
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("decodeContractReturnData decodes integer values as bigint", () => {
  const decoded = decodeContractReturnData("42");
  assert.strictEqual(decoded, 42n);
});

test("decodeContractReturnData decodes JSON object values", () => {
  const decoded = decodeContractReturnData('{"ok":true,"count":3}');
  assert.deepStrictEqual(decoded, { ok: true, count: 3 });
});

test("decodeContractReturnData handles empty and plain text values", () => {
  assert.strictEqual(decodeContractReturnData(""), null);
  assert.strictEqual(decodeContractReturnData("hello"), "hello");
});

test("encodeUtf8Hex and decodeUtf8Hex round-trip arbitrary UTF-8", () => {
  const raw = '{"vm":"qtx-v1","note":"halo quantix"}';
  assert.strictEqual(decodeUtf8Hex(encodeUtf8Hex(raw)), raw);
});
