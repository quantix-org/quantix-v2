import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

interface Head {
  height: number;
  hash: string;
}

const RPC_PORTS = [7331, 7332, 7333];
const CONFIG_PATH = resolve(process.cwd(), "testnets/devnet/config.json");

test(
  "3-node devnet converges on latest head",
  { timeout: 60000 },
  async () => {
    const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-devnet-converge-"));
    const dataDirByNode = createDataDirMap(runDataDir);
    const children: ChildProcess[] = [];

    try {
      children.push(startValidator("validator-alice", 7331, dataDirByNode["validator-alice"]));
      children.push(startValidator("validator-bob", 7332, dataDirByNode["validator-bob"]));
      children.push(startValidator("validator-carol", 7333, dataDirByNode["validator-carol"]));

      await waitForAllRpcReady(RPC_PORTS, 20000);
      await waitForConvergence(RPC_PORTS, 2, 25000);

      const heads = await Promise.all(RPC_PORTS.map((port) => getHead(port)));
      assert.ok(heads.every((head) => head.height >= 2), "all nodes should advance beyond bootstrap height");
      assert.ok(heads.every((head) => head.hash === heads[0].hash), "all nodes should converge on same head hash");
    } finally {
      await Promise.all(children.map((child) => stopChild(child)));
      await rm(runDataDir, { recursive: true, force: true });
    }
  },
);

test(
  "restarted validator catches up from persisted state and peer sync",
  { timeout: 90000 },
  async () => {
    const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-devnet-restart-"));
    const dataDirByNode = createDataDirMap(runDataDir);
    const childrenByNode = new Map<string, ChildProcess>();

    try {
      childrenByNode.set("validator-alice", startValidator("validator-alice", 7331, dataDirByNode["validator-alice"]));
      childrenByNode.set("validator-bob", startValidator("validator-bob", 7332, dataDirByNode["validator-bob"]));
      childrenByNode.set("validator-carol", startValidator("validator-carol", 7333, dataDirByNode["validator-carol"]));

      await waitForAllRpcReady(RPC_PORTS, 25000);
      await waitForConvergence(RPC_PORTS, 2, 30000);

      const baseline = await getHead(7331);

      const bob = childrenByNode.get("validator-bob");
      assert.ok(bob, "validator-bob process should exist");
      await stopChild(bob);
      childrenByNode.delete("validator-bob");

      // Quorum for a 3-validator network requires all 3 votes (floor(2*3/3)+1 = 3).
      // Alice and carol cannot commit new blocks while bob is offline.
      // Wait briefly to confirm the network halts, then bring bob back.
      await sleep(2400);

      childrenByNode.set("validator-bob", startValidator("validator-bob", 7332, dataDirByNode["validator-bob"]));
      await waitForRpcReady(7332, 20000);
      await waitForConvergence(RPC_PORTS, baseline.height + 2, 35000);

      const finalHeads = await Promise.all(RPC_PORTS.map((port) => getHead(port)));
      assert.ok(
        finalHeads.every((head) => head.height >= baseline.height + 2),
        "all validators should advance once the restarted node rejoins the network",
      );
      assert.ok(
        finalHeads.every((head) => head.hash === finalHeads[0].hash),
        "restarted validator should converge on the same final hash",
      );
    } finally {
      await Promise.all([...childrenByNode.values()].map((child) => stopChild(child)));
      await rm(runDataDir, { recursive: true, force: true });
    }
  },
);

function startValidator(nodeId: string, rpcPort: number, dataDir: string): ChildProcess {
  const child = spawn("node_modules/.bin/tsx", ["apps/node/src/main.ts"], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      NODE_ID: nodeId,
      QTX_RPC_PORT: String(rpcPort),
      QTX_CONFIG_PATH: CONFIG_PATH,
      QTX_DATA_DIR: dataDir,
      QTX_BLOCK_INTERVAL_MS: "1200",
    },
    stdio: "ignore",
  });
  child.unref();
  return child;
}

function createDataDirMap(rootDir: string): Record<string, string> {
  return {
    "validator-alice": resolve(rootDir, "validator-alice"),
    "validator-bob": resolve(rootDir, "validator-bob"),
    "validator-carol": resolve(rootDir, "validator-carol"),
  };
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const checks = await Promise.all(
      ports.map(async (port) => {
        try {
          await getHead(port);
          return true;
        } catch {
          return false;
        }
      }),
    );

    if (checks.every(Boolean)) {
      return;
    }

    await sleep(250);
  }

  throw new Error("timed out waiting for all validators to expose RPC");
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

    if (heads.every((head): head is Head => head !== null)) {
      const allAtHeight = heads.every((head) => head.height >= minHeight);
      const sameHash = heads.every((head) => head.hash === heads[0].hash);
      const sameHeight = heads.every((head) => head.height === heads[0].height);
      if (allAtHeight && sameHash && sameHeight) {
        return;
      }
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

  throw new Error(`timed out waiting for convergence: ${JSON.stringify(finalHeads)}`);
}

async function getHead(port: number): Promise<Head> {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "qtx_getLatestBlock",
      params: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${port} returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: Head;
    error?: { message: string };
  };

  if (payload.error) {
    throw new Error(payload.error.message);
  }

  if (!payload.result) {
    throw new Error("missing result");
  }

  return payload.result;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function getValidators(
  port: number,
): Promise<Array<{ id: string; active: boolean; slashed: boolean }>> {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "qtx_getValidators", params: [] }),
  });
  const payload = (await response.json()) as {
    result?: Array<{ id: string; active: boolean; slashed: boolean }>;
  };
  return payload.result ?? [];
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

function buildFakeProposal(
  height: number,
  parentHash: string,
  proposerId: string,
): { height: number; parentHash: string; proposerId: string; txs: never[]; hash: string } {
  // Mirrors the hashProposal logic in main.ts (empty txs → empty join string).
  const hash = createHash("sha256")
    .update(`${height}:${parentHash}:${proposerId}:`)
    .digest("hex");
  return { height, parentHash, proposerId, txs: [], hash };
}

test(
  "qtx_consensusPrepare rejects proposal from non-proposer validator",
  { timeout: 30000 },
  async () => {
    const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-devnet-proposer-"));
    const children: ChildProcess[] = [];

    try {
      children.push(startValidator("validator-alice", 7331, resolve(runDataDir, "validator-alice")));
      children.push(startValidator("validator-bob", 7332, resolve(runDataDir, "validator-bob")));
      children.push(startValidator("validator-carol", 7333, resolve(runDataDir, "validator-carol")));

      await waitForAllRpcReady(RPC_PORTS, 20000);
      await waitForConvergence(RPC_PORTS, 1, 15000);

      const head = await getHead(7331);
      const validators = await getValidators(7331);
      const activeIds = validators
        .filter((v) => v.active && !v.slashed)
        .map((v) => v.id)
        .sort();
      const expectedProposer = activeIds[head.height % activeIds.length];
      const nonProposer = activeIds.find((id) => id !== expectedProposer) ?? activeIds[1];

      const fakeProposal = buildFakeProposal(head.height + 1, head.hash, nonProposer);
      const result = await rpcResultRaw<unknown>(7331, "qtx_consensusPrepare", [fakeProposal]);

      assert.strictEqual(result, null, "prepare from illegitimate proposer must be rejected with null");
    } finally {
      await Promise.all(children.map((child) => stopChild(child)));
      await rm(runDataDir, { recursive: true, force: true });
    }
  },
);

test(
  "qtx_consensusCommit rejects votes with forged signatures",
  { timeout: 30000 },
  async () => {
    const runDataDir = await mkdtemp(resolve(tmpdir(), "quantix-devnet-forgedvote-"));
    const children: ChildProcess[] = [];

    try {
      children.push(startValidator("validator-alice", 7331, resolve(runDataDir, "validator-alice")));
      children.push(startValidator("validator-bob", 7332, resolve(runDataDir, "validator-bob")));
      children.push(startValidator("validator-carol", 7333, resolve(runDataDir, "validator-carol")));

      await waitForAllRpcReady(RPC_PORTS, 20000);
      await waitForConvergence(RPC_PORTS, 1, 15000);

      const head = await getHead(7332);
      const validators = await getValidators(7332);
      const activeIds = validators
        .filter((v) => v.active && !v.slashed)
        .map((v) => v.id)
        .sort();
      const expectedProposer = activeIds[head.height % activeIds.length];

      // Inject a valid proposal into bob's pendingProposals using the correct proposer ID.
      // If bob's height has advanced by the time this arrives, the prepare returns null and
      // the proposalHash will not be in pendingProposals — the commit will then be rejected
      // as "unknown proposal", which is still committed: false.
      const fakeProposal = buildFakeProposal(head.height + 1, head.hash, expectedProposer);
      await rpcResultRaw<unknown>(7332, "qtx_consensusPrepare", [fakeProposal]);

      // Send commit with correctly-sized but cryptographically invalid signatures.
      // ML-DSA-87 signatures are 4595 bytes; all-zero bytes will never verify.
      const forgedVotes = activeIds.map((id) => ({
        proposalHash: fakeProposal.hash,
        height: fakeProposal.height,
        voterId: id,
        signature: "00".repeat(4595),
      }));

      const result = await rpcResultRaw<{ committed: boolean; reason?: string }>(
        7332,
        "qtx_consensusCommit",
        [fakeProposal.hash, forgedVotes],
      );

      assert.strictEqual(result?.committed, false, "commit with forged vote signatures must not be accepted");
    } finally {
      await Promise.all(children.map((child) => stopChild(child)));
      await rm(runDataDir, { recursive: true, force: true });
    }
  },
);

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolvePromise) => {
    child.once("exit", () => resolvePromise());
  });

  // Kill the entire process group to ensure tsx sub-processes are also terminated.
  try {
    process.kill(-(child.pid!), "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  const timeout = sleep(1200).then(() => {
    if (child.exitCode === null) {
      try {
        process.kill(-(child.pid!), "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  });

  await Promise.race([exited, timeout.then(() => exited)]);
}
