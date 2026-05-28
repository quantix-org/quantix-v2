/**
 * 4-node devnet integration tests.
 *
 * Uses ports 7341-7344 (separate from the 3-node devnet on 7331-7333)
 * so both suites can run in the same session without port conflicts.
 *
 * Scenarios:
 *   1. All 4 nodes converge on the same head hash at height >= 2.
 *   2. A transaction submitted to alice gossips to bob, carol, and dave.
 *   3. With one validator offline the remaining three still reach quorum
 *      (quorum = floor(2*4/3)+1 = 3) and keep committing blocks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT_ALICE = 7341;
const PORT_BOB = 7342;
const PORT_CAROL = 7343;
const PORT_DAVE = 7344;
const ALL_PORTS = [PORT_ALICE, PORT_BOB, PORT_CAROL, PORT_DAVE];

const CONFIG_PATH = resolve(process.cwd(), "testnets/devnet-4/config.json");
const GENESIS_PATH = resolve(process.cwd(), "testnets/devnet-4/genesis.json");

// ---------------------------------------------------------------------------
// Test 1 – all four nodes converge
// ---------------------------------------------------------------------------

test("4-node devnet converges on latest head", { timeout: 90000 }, async () => {
  const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-devnet4-converge-"));
  const children: ChildProcess[] = [];

  try {
    children.push(startValidator("validator-alice", PORT_ALICE, resolve(runDataDir, "validator-alice")));
    children.push(startValidator("validator-bob", PORT_BOB, resolve(runDataDir, "validator-bob")));
    children.push(startValidator("validator-carol", PORT_CAROL, resolve(runDataDir, "validator-carol")));
    children.push(startValidator("validator-dave", PORT_DAVE, resolve(runDataDir, "validator-dave")));

    await waitForAllRpcReady(ALL_PORTS, 30000);
    await waitForConvergence(ALL_PORTS, 2, 40000);

    const heads = await Promise.all(ALL_PORTS.map((port) => getHead(port)));

    assert.ok(
      heads.every((head) => head.height >= 2),
      `all 4 nodes should advance beyond bootstrap height, got: ${JSON.stringify(heads)}`,
    );
    assert.ok(
      heads.every((head) => head.hash === heads[0].hash),
      `all 4 nodes should agree on the same head hash, got: ${JSON.stringify(heads)}`,
    );
  } finally {
    await Promise.all(children.map(stopChild));
    await rm(runDataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 – gossip: tx submitted to alice propagates to all other nodes
// ---------------------------------------------------------------------------

test("4-node: submitted transaction gossips to all peers", { timeout: 90000 }, async () => {
  const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-devnet4-gossip-"));
  const children: ChildProcess[] = [];

  try {
    children.push(startValidator("validator-alice", PORT_ALICE, resolve(runDataDir, "validator-alice")));
    children.push(startValidator("validator-bob", PORT_BOB, resolve(runDataDir, "validator-bob")));
    children.push(startValidator("validator-carol", PORT_CAROL, resolve(runDataDir, "validator-carol")));
    children.push(startValidator("validator-dave", PORT_DAVE, resolve(runDataDir, "validator-dave")));

    await waitForAllRpcReady(ALL_PORTS, 30000);
    // Wait until nodes have exchanged at least one block so gossip peers are live.
    await waitForConvergence(ALL_PORTS, 1, 30000);

    // Obtain bob's address so we have a valid recipient for a seed transfer.
    const state = await rpcResultRaw<{
      validators: Record<string, { owner: string }>;
    }>(PORT_ALICE, "qtx_getState", []);

    const bobAddress = state.validators["validator-bob"]?.owner;
    assert.ok(bobAddress, "validator-bob address must exist in genesis state");

    // Submit a transfer from alice → bob.
    const submitResult = await rpcResultRaw<{ txHash: string }>(
      PORT_ALICE,
      "qtx_seedTransfer",
      [bobAddress, "10"],
    );
    const txHash = submitResult.txHash;
    assert.ok(txHash, "qtx_seedTransfer must return a txHash");

    // Allow enough time for the gossip fire-and-forget to complete.
    await sleep(2000);

    // The tx must appear in bob's, carol's, and dave's mempools.
    // (alice has already enqueued it locally, so we only check peers.)
    for (const port of [PORT_BOB, PORT_CAROL, PORT_DAVE]) {
      const mempool = await rpcResultRaw<Array<{ hash: string }>>(port, "qtx_getMempool", []);
      assert.ok(
        mempool.some((entry) => entry.hash === txHash),
        `node on port ${port} should have tx ${txHash} in mempool, got: ${JSON.stringify(mempool.map((e) => e.hash))}`,
      );
    }
  } finally {
    await Promise.all(children.map(stopChild));
    await rm(runDataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 – fault tolerance: 1 of 4 validators offline, rest continue
// ---------------------------------------------------------------------------

test("4-node: tolerates one offline validator (quorum = 3 of 4)", { timeout: 120000 }, async () => {
  const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-devnet4-fault-"));
  const childrenByNode = new Map<string, ChildProcess>();

  try {
    childrenByNode.set("validator-alice", startValidator("validator-alice", PORT_ALICE, resolve(runDataDir, "validator-alice")));
    childrenByNode.set("validator-bob", startValidator("validator-bob", PORT_BOB, resolve(runDataDir, "validator-bob")));
    childrenByNode.set("validator-carol", startValidator("validator-carol", PORT_CAROL, resolve(runDataDir, "validator-carol")));
    childrenByNode.set("validator-dave", startValidator("validator-dave", PORT_DAVE, resolve(runDataDir, "validator-dave")));

    await waitForAllRpcReady(ALL_PORTS, 30000);
    await waitForConvergence(ALL_PORTS, 2, 40000);

    const baseline = await getHead(PORT_ALICE);

    // Take dave offline.
    const dave = childrenByNode.get("validator-dave")!;
    await stopChild(dave);
    childrenByNode.delete("validator-dave");

    const remainingPorts = [PORT_ALICE, PORT_BOB, PORT_CAROL];

    // With quorum = floor(2*4/3)+1 = 3, alice+bob+carol (3 nodes) can still commit.
    await waitForConvergence(remainingPorts, baseline.height + 2, 50000);

    const finalHeads = await Promise.all(remainingPorts.map((port) => getHead(port)));

    assert.ok(
      finalHeads.every((head) => head.height >= baseline.height + 2),
      `remaining validators should commit at least 2 more blocks after dave goes offline, got: ${JSON.stringify(finalHeads)}`,
    );
    assert.ok(
      finalHeads.every((head) => head.hash === finalHeads[0].hash),
      `remaining validators should agree on same head, got: ${JSON.stringify(finalHeads)}`,
    );
  } finally {
    await Promise.all([...childrenByNode.values()].map(stopChild));
    await rm(runDataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startValidator(nodeId: string, rpcPort: number, dataDir: string): ChildProcess {
  const child = spawn("node_modules/.bin/tsx", ["apps/node/src/main.ts"], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      NODE_ID: nodeId,
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

async function waitForRpcReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await getHead(port);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`timed out waiting for validator RPC on port ${port}`);
}

async function waitForAllRpcReady(ports: number[], timeoutMs: number): Promise<void> {
  await Promise.all(ports.map((port) => waitForRpcReady(port, timeoutMs)));
}

async function waitForConvergence(ports: number[], minHeight: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const heads = await Promise.all(
      ports.map(async (port) => {
        try {
          return await getHead(port);
        } catch {
          return null;
        }
      }),
    );

    if (heads.every((h): h is Head => h !== null)) {
      const allAtHeight = heads.every((h) => h.height >= minHeight);
      const sameHash = heads.every((h) => h.hash === heads[0].hash);
      const sameHeight = heads.every((h) => h.height === heads[0].height);
      if (allAtHeight && sameHash && sameHeight) return;
    }

    await sleep(400);
  }

  const finalHeads = await Promise.all(
    ports.map(async (port) => {
      try {
        return await getHead(port);
      } catch {
        return null;
      }
    }),
  );
  throw new Error(`timed out waiting for convergence at height >= ${minHeight}: ${JSON.stringify(finalHeads)}`);
}

interface Head {
  height: number;
  hash: string;
}

async function getHead(port: number): Promise<Head> {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "qtx_getLatestBlock", params: [] }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${port} returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: Head;
    error?: { message: string };
  };

  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("missing result");
  return payload.result;
}

async function rpcResultRaw<T>(port: number, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = (await response.json()) as { result?: T };
  return payload.result as T;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });

  try {
    process.kill(-(child.pid!), "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  const forceKill = sleep(1200).then(() => {
    if (child.exitCode === null) {
      try {
        process.kill(-(child.pid!), "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  });

  await Promise.race([exited, forceKill.then(() => exited)]);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
