import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { deriveAddressFromPublicKey, generatePqKeyPair, signPqMessage } from "@quantix/crypto";
import { transactionSigningPayload, type Transaction } from "@quantix/protocol";

const PORT = 7360;
const PORT_TOKEN = 7361;
const PORT_VM = 7362;
const CONFIG_PATH = resolve(process.cwd(), "testnets/devnet/config.json");
const GENESIS_PATH = resolve(process.cwd(), "testnets/devnet/genesis.json");

interface RpcEnvelope<T> {
  result?: T;
  error?: { code: number; message: string };
}

test("contract RPC flow: deploy -> call -> receipt/events/storage", { timeout: 90000 }, async () => {
  const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-contract-rpc-"));
  const child = startSeedNode(PORT, runDataDir);

  try {
    await waitForRpcReady(PORT, 25000);

    const config = await readDevnetConfig();
    const seedKeys = generatePqKeyPair(config.seedNode.seedHex);
    const seedAddress = deriveAddressFromPublicKey(seedKeys.publicKey);

    const chainInfo = await rpcCall<{ chainId: string }>(PORT, "qtx_getChainInfo", []);
    const balance = await rpcCall<{ nonce: number }>(PORT, "qtx_getBalance", [seedAddress]);

    const deployTx = signTx(seedKeys.privateKey, {
      type: "contract_deploy",
      chainId: chainInfo.chainId,
      from: seedAddress,
      nonce: balance.nonce + 1,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
      contractCode: "aabbccdd",
      gasLimit: 300000,
      maxFeePerGas: 1n,
      value: 0n,
      salt: "rpc-flow",
    });

    await rpcCall(PORT, "qtx_submitTransaction", [serializeTx(deployTx)]);

    const deployReceipt = await waitForReceipt(PORT, txHash(deployTx), 30000);
    assert.equal(deployReceipt.type, "contract_deploy");
    assert.equal(deployReceipt.success, true);
    assert.ok(deployReceipt.contractAddress.startsWith("qtxContract"));

    const callTx = signTx(seedKeys.privateKey, {
      type: "contract_call",
      chainId: chainInfo.chainId,
      from: seedAddress,
      nonce: balance.nonce + 2,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
      contractAddress: deployReceipt.contractAddress,
      method: "setCounter",
      args: [42],
      gasLimit: 300000,
      maxFeePerGas: 1n,
      value: 0n,
    });

    await rpcCall(PORT, "qtx_submitTransaction", [serializeTx(callTx)]);

    const callReceipt = await waitForReceipt(PORT, txHash(callTx), 30000);
    assert.equal(callReceipt.type, "contract_call");
    assert.equal(callReceipt.success, true);
    assert.equal(callReceipt.contractAddress, deployReceipt.contractAddress);

    const storage = await rpcCall<{ contractAddress: string; storage: Record<string, string> }>(
      PORT,
      "qtx_getStorage",
      [deployReceipt.contractAddress],
    );
    assert.equal(storage.contractAddress, deployReceipt.contractAddress);
    assert.ok(storage.storage.__lastCall);

    const events = await rpcCall<Array<{ name: string; txHash: string }>>(
      PORT,
      "qtx_getEvents",
      [deployReceipt.contractAddress, 0, Number.MAX_SAFE_INTEGER, ""],
    );
    assert.ok(events.some((e) => e.txHash === txHash(deployTx) && e.name === "ContractDeployed"));
    assert.ok(events.some((e) => e.txHash === txHash(callTx) && e.name === "ContractCalled"));

    const byBlock = await rpcCall<Array<{ txHash: string }>>(
      PORT,
      "qtx_getReceiptsByBlock",
      [callReceipt.blockHeight],
    );
    assert.ok(byBlock.some((r) => r.txHash === txHash(callTx)));

    const txList = await rpcCall<Array<{ txHash?: string; hash?: string; type: string }>>(
      PORT,
      "qtx_getContractTransactions",
      [deployReceipt.contractAddress, 0, Number.MAX_SAFE_INTEGER],
    );
    assert.ok(txList.some((entry) => (entry.hash ?? entry.txHash) === txHash(deployTx) && entry.type === "contract_deploy"));
    assert.ok(txList.some((entry) => (entry.hash ?? entry.txHash) === txHash(callTx) && entry.type === "contract_call"));
  } finally {
    await stopChild(child);
    await rm(runDataDir, { recursive: true, force: true });
  }
});

test("contract RPC token flow: init -> transfer -> approve -> transfer_from", { timeout: 90000 }, async () => {
  const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-contract-token-rpc-"));
  const child = startSeedNode(PORT_TOKEN, runDataDir);

  try {
    await waitForRpcReady(PORT_TOKEN, 25000);

    const config = await readDevnetConfig();
    const seedKeys = generatePqKeyPair(config.seedNode.seedHex);
    const seedAddress = deriveAddressFromPublicKey(seedKeys.publicKey);
    const bob = generatePqKeyPair();
    const bobAddress = deriveAddressFromPublicKey(bob.publicKey);
    const carol = generatePqKeyPair();
    const carolAddress = deriveAddressFromPublicKey(carol.publicKey);

    const chainInfo = await rpcCall<{ chainId: string }>(PORT_TOKEN, "qtx_getChainInfo", []);
    const seedBalance = await rpcCall<{ nonce: number }>(PORT_TOKEN, "qtx_getBalance", [seedAddress]);

    const fundBob = signTx(seedKeys.privateKey, {
      type: "transfer",
      chainId: chainInfo.chainId,
      from: seedAddress,
      to: bobAddress,
      nonce: seedBalance.nonce + 1,
      timestamp: Date.now(),
      amount: 10n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
    });
    await rpcCall(PORT_TOKEN, "qtx_submitTransaction", [serializeTx(fundBob)]);
    await waitForTxCommitted(PORT_TOKEN, txHash(fundBob), 30000);

    const fundCarol = signTx(seedKeys.privateKey, {
      type: "transfer",
      chainId: chainInfo.chainId,
      from: seedAddress,
      to: carolAddress,
      nonce: seedBalance.nonce + 2,
      timestamp: Date.now(),
      amount: 10n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
    });
    await rpcCall(PORT_TOKEN, "qtx_submitTransaction", [serializeTx(fundCarol)]);
    await waitForTxCommitted(PORT_TOKEN, txHash(fundCarol), 30000);

    const deployTx = signTx(seedKeys.privateKey, {
      type: "contract_deploy",
      chainId: chainInfo.chainId,
      from: seedAddress,
      nonce: seedBalance.nonce + 3,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
      contractCode: "aabbccdd",
      gasLimit: 300000,
      maxFeePerGas: 1n,
      value: 0n,
      salt: "rpc-token-flow",
    });
    await rpcCall(PORT_TOKEN, "qtx_submitTransaction", [serializeTx(deployTx)]);
    const deployReceipt = await waitForReceipt(PORT_TOKEN, txHash(deployTx), 30000);

    const initTx = signTx(seedKeys.privateKey, {
      type: "contract_call",
      chainId: chainInfo.chainId,
      from: seedAddress,
      nonce: seedBalance.nonce + 4,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
      contractAddress: deployReceipt.contractAddress,
      method: "token_init",
      args: [{ name: "Quantix USD", symbol: "QUSD", decimals: 6, initialSupply: "1000", owner: seedAddress }],
      gasLimit: 300000,
      maxFeePerGas: 1n,
      value: 0n,
    });
    await rpcCall(PORT_TOKEN, "qtx_submitTransaction", [serializeTx(initTx)]);
    const initReceipt = await waitForReceipt(PORT_TOKEN, txHash(initTx), 30000);
    assert.equal(initReceipt.success, true);

    const bobBalance = await rpcCall<{ nonce: number }>(PORT_TOKEN, "qtx_getBalance", [bobAddress]);
    const carolBalance = await rpcCall<{ nonce: number }>(PORT_TOKEN, "qtx_getBalance", [carolAddress]);

    const transferTx = signTx(seedKeys.privateKey, {
      type: "contract_call",
      chainId: chainInfo.chainId,
      from: seedAddress,
      nonce: seedBalance.nonce + 5,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
      contractAddress: deployReceipt.contractAddress,
      method: "token_transfer",
      args: [bobAddress, "200"],
      gasLimit: 300000,
      maxFeePerGas: 1n,
      value: 0n,
    });
    await rpcCall(PORT_TOKEN, "qtx_submitTransaction", [serializeTx(transferTx)]);
    await waitForReceipt(PORT_TOKEN, txHash(transferTx), 30000);

    const approveTx = signTx(bob.privateKey, {
      type: "contract_call",
      chainId: chainInfo.chainId,
      from: bobAddress,
      nonce: bobBalance.nonce + 1,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: bob.publicKey,
      signature: "",
      contractAddress: deployReceipt.contractAddress,
      method: "token_approve",
      args: [carolAddress, "50"],
      gasLimit: 300000,
      maxFeePerGas: 1n,
      value: 0n,
    });
    await rpcCall(PORT_TOKEN, "qtx_submitTransaction", [serializeTx(approveTx)]);
    await waitForReceipt(PORT_TOKEN, txHash(approveTx), 30000);

    const transferFromTx = signTx(carol.privateKey, {
      type: "contract_call",
      chainId: chainInfo.chainId,
      from: carolAddress,
      nonce: carolBalance.nonce + 1,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: carol.publicKey,
      signature: "",
      contractAddress: deployReceipt.contractAddress,
      method: "token_transfer_from",
      args: [bobAddress, carolAddress, "20"],
      gasLimit: 300000,
      maxFeePerGas: 1n,
      value: 0n,
    });
    await rpcCall(PORT_TOKEN, "qtx_submitTransaction", [serializeTx(transferFromTx)]);
    const transferFromReceipt = await waitForReceipt(PORT_TOKEN, txHash(transferFromTx), 30000);
    assert.equal(transferFromReceipt.success, true);
    assert.equal(transferFromReceipt.type, "contract_call");

    const storage = await rpcCall<{ contractAddress: string; storage: Record<string, string> }>(
      PORT_TOKEN,
      "qtx_getStorage",
      [deployReceipt.contractAddress],
    );
    assert.equal(storage.storage[`token:bal:${seedAddress}`], "800");
    assert.equal(storage.storage[`token:bal:${bobAddress}`], "180");
    assert.equal(storage.storage[`token:bal:${carolAddress}`], "20");
    assert.equal(storage.storage[`token:allow:${bobAddress}:${carolAddress}`], "30");

    const transferEvents = await rpcCall<Array<{ name: string; txHash: string }>>(
      PORT_TOKEN,
      "qtx_getEvents",
      [deployReceipt.contractAddress, 0, Number.MAX_SAFE_INTEGER, "Transfer"],
    );
    assert.ok(transferEvents.some((e) => e.txHash === txHash(transferFromTx)));
  } finally {
    await stopChild(child);
    await rm(runDataDir, { recursive: true, force: true });
  }
});

test("contract RPC qtx-v1 flow: user-defined methods execute over RPC", { timeout: 90000 }, async () => {
  const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-contract-vm-rpc-"));
  const child = startSeedNode(PORT_VM, runDataDir);

  try {
    await waitForRpcReady(PORT_VM, 25000);

    const config = await readDevnetConfig();
    const seedKeys = generatePqKeyPair(config.seedNode.seedHex);
    const seedAddress = deriveAddressFromPublicKey(seedKeys.publicKey);

    const chainInfo = await rpcCall<{ chainId: string }>(PORT_VM, "qtx_getChainInfo", []);
    const balance = await rpcCall<{ nonce: number }>(PORT_VM, "qtx_getBalance", [seedAddress]);

    const qtxV1Json = JSON.stringify({
      vm: "qtx-v1",
      methods: {
        setGreeting: [
          { op: "set", key: "greeting", arg: 0 },
          { op: "emit", name: "GreetingSet", arg: 0 },
          { op: "return", key: "greeting" },
        ],
        setGreetingViaValueArg: [
          { op: "set", key: "greeting_v2", value: { "$arg": 0 } },
          { op: "emit", name: "GreetingSetV2", data: { "$arg": 0 } },
          { op: "return", key: "greeting_v2" },
        ],
      },
    });
    const qtxV1Code = Buffer.from(qtxV1Json, "utf8").toString("hex");

    const deployTx = signTx(seedKeys.privateKey, {
      type: "contract_deploy",
      chainId: chainInfo.chainId,
      from: seedAddress,
      nonce: balance.nonce + 1,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
      contractCode: qtxV1Code,
      gasLimit: 320000,
      maxFeePerGas: 1n,
      value: 0n,
      salt: "rpc-qtx-v1",
    });
    await rpcCall(PORT_VM, "qtx_submitTransaction", [serializeTx(deployTx)]);
    const deployReceipt = await waitForReceipt(PORT_VM, txHash(deployTx), 30000);
    assert.equal(deployReceipt.success, true);

    const setGreetingTx = signTx(seedKeys.privateKey, {
      type: "contract_call",
      chainId: chainInfo.chainId,
      from: seedAddress,
      nonce: balance.nonce + 2,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
      contractAddress: deployReceipt.contractAddress,
      method: "setGreeting",
      args: ["hello-from-rpc"],
      gasLimit: 300000,
      maxFeePerGas: 1n,
      value: 0n,
    });
    await rpcCall(PORT_VM, "qtx_submitTransaction", [serializeTx(setGreetingTx)]);
    const setGreetingReceipt = await waitForReceipt(PORT_VM, txHash(setGreetingTx), 30000);
    assert.equal(setGreetingReceipt.success, true);

    const setGreetingV2Tx = signTx(seedKeys.privateKey, {
      type: "contract_call",
      chainId: chainInfo.chainId,
      from: seedAddress,
      nonce: balance.nonce + 3,
      timestamp: Date.now(),
      amount: 0n,
      fee: 0n,
      signerPublicKey: seedKeys.publicKey,
      signature: "",
      contractAddress: deployReceipt.contractAddress,
      method: "setGreetingViaValueArg",
      args: ["hello-v2-from-rpc"],
      gasLimit: 300000,
      maxFeePerGas: 1n,
      value: 0n,
    });
    await rpcCall(PORT_VM, "qtx_submitTransaction", [serializeTx(setGreetingV2Tx)]);
    const setGreetingV2Receipt = await waitForReceipt(PORT_VM, txHash(setGreetingV2Tx), 30000);
    assert.equal(setGreetingV2Receipt.success, true);

    const storage = await rpcCall<{ contractAddress: string; storage: Record<string, string> }>(
      PORT_VM,
      "qtx_getStorage",
      [deployReceipt.contractAddress],
    );
    assert.equal(storage.storage.greeting, "hello-from-rpc");
    assert.equal(storage.storage.greeting_v2, "hello-v2-from-rpc");

    const receipt = await rpcCall<{ returnData?: string }>(PORT_VM, "qtx_getReceipt", [txHash(setGreetingTx)]);
    assert.equal(receipt.returnData, "hello-from-rpc");

    const receiptV2 = await rpcCall<{ returnData?: string }>(PORT_VM, "qtx_getReceipt", [txHash(setGreetingV2Tx)]);
    assert.equal(receiptV2.returnData, "hello-v2-from-rpc");

    const events = await rpcCall<Array<{ name: string; txHash: string }>>(
      PORT_VM,
      "qtx_getEvents",
      [deployReceipt.contractAddress, 0, Number.MAX_SAFE_INTEGER, "GreetingSet"],
    );
    assert.ok(events.some((e) => e.txHash === txHash(setGreetingTx)));

    const eventsV2 = await rpcCall<Array<{ name: string; txHash: string }>>(
      PORT_VM,
      "qtx_getEvents",
      [deployReceipt.contractAddress, 0, Number.MAX_SAFE_INTEGER, "GreetingSetV2"],
    );
    assert.ok(eventsV2.some((e) => e.txHash === txHash(setGreetingV2Tx)));
  } finally {
    await stopChild(child);
    await rm(runDataDir, { recursive: true, force: true });
  }
});

function startSeedNode(rpcPort: number, dataDir: string): ChildProcess {
  const child = spawn("node_modules/.bin/tsx", ["apps/node/src/main.ts"], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      NODE_ID: "seednode",
      QTX_RPC_PORT: String(rpcPort),
      QTX_CONFIG_PATH: CONFIG_PATH,
      QTX_GENESIS_PATH: GENESIS_PATH,
      QTX_DATA_DIR: dataDir,
      QTX_BLOCK_INTERVAL_MS: "1200",
    },
    stdio: "ignore",
  });
  child.unref();
  return child;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Process may already be gone.
  }
}

async function readDevnetConfig(): Promise<{ seedNode: { seedHex: string } }> {
  const raw = await readFile(CONFIG_PATH, "utf8");
  return JSON.parse(raw) as { seedNode: { seedHex: string } };
}

async function waitForRpcReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await rpcCall(port, "qtx_getLatestBlock", []);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`timed out waiting for RPC on port ${port}`);
}

async function waitForReceipt(
  port: number,
  txHashHex: string,
  timeoutMs: number,
): Promise<{ type: string; success: boolean; contractAddress: string; blockHeight: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await rpcCall<{
        type: string;
        success: boolean;
        contractAddress: string;
        blockHeight: number;
      }>(port, "qtx_getReceipt", [txHashHex]);
      return receipt;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`timed out waiting for receipt ${txHashHex}`);
}

async function waitForTxCommitted(port: number, txHashHex: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await rpcCall(port, "qtx_getTransaction", [txHashHex]);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`timed out waiting for tx ${txHashHex}`);
}

async function rpcCall<T>(port: number, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as RpcEnvelope<T>;
  if (payload.error) {
    throw new Error(payload.error.message);
  }
  return payload.result as T;
}

function signTx(privateKey: string, unsigned: Transaction): Transaction {
  const payload = transactionSigningPayload(unsigned);
  return {
    ...unsigned,
    signature: signPqMessage(privateKey, payload),
  };
}

function txHash(tx: Transaction): string {
  return createHash("sha256").update(transactionSigningPayload(tx)).digest("hex");
}

function serializeTx(tx: Transaction): Record<string, unknown> {
  const out: Record<string, unknown> = {
    chainId: tx.chainId,
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
