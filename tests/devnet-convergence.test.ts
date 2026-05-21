import test from "node:test";
import assert from "node:assert/strict";
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

      await waitForConvergence([7331, 7333], baseline.height + 2, 30000);

      childrenByNode.set("validator-bob", startValidator("validator-bob", 7332, dataDirByNode["validator-bob"]));
      await waitForRpcReady(7332, 20000);
      await waitForConvergence(RPC_PORTS, baseline.height + 2, 35000);

      const finalHeads = await Promise.all(RPC_PORTS.map((port) => getHead(port)));
      assert.ok(
        finalHeads.every((head) => head.height >= baseline.height + 2),
        "all nodes should advance while one validator was offline",
      );
      assert.ok(
        finalHeads.every((head) => head.hash === finalHeads[0].hash),
        "restarted validator should converge on same final hash",
      );
    } finally {
      await Promise.all([...childrenByNode.values()].map((child) => stopChild(child)));
      await rm(runDataDir, { recursive: true, force: true });
    }
  },
);

function startValidator(nodeId: string, rpcPort: number, dataDir: string): ChildProcess {
  return spawn("npm", ["run", "-w", "@quantix/node", "dev"], {
    cwd: process.cwd(),
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

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolvePromise) => {
    child.once("exit", () => resolvePromise());
  });

  child.kill("SIGTERM");

  const timeout = sleep(1200).then(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  });

  await Promise.race([exited, timeout.then(() => exited)]);
}
