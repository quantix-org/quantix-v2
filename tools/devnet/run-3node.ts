import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface NodeEntry {
  id: string;
  rpcPort: number;
}

interface DevnetConfig {
  seedNode: NodeEntry;
  validators: NodeEntry[];
}

const configPath = resolve(process.cwd(), process.env.QTX_CONFIG_PATH ?? "testnets/devnet/config.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as DevnetConfig;

function spawnNode(node: NodeEntry): ChildProcess {
  const child = spawn(
    "npm",
    ["run", "-w", "@quantix/node", "dev"],
    {
      env: {
        ...process.env,
        NODE_ID: node.id,
        QTX_RPC_PORT: String(node.rpcPort),
        QTX_CONFIG_PATH: configPath,
      },
      stdio: "inherit",
    },
  );
  child.on("exit", (code) => {
    console.log(`[devnet] ${node.id} exited with code ${code ?? 0}`);
  });
  return child;
}

// Start seednode first — it bootstraps the genesis state.
const seedChild = spawnNode(config.seedNode);

// Give seednode a head start before validators try to gossip stake txs.
const VALIDATOR_START_DELAY_MS = 2000;
const allChildren: ChildProcess[] = [seedChild];

setTimeout(() => {
  for (const validator of config.validators) {
    allChildren.push(spawnNode(validator));
  }
}, VALIDATOR_START_DELAY_MS);

process.on("SIGINT", () => {
  for (const child of allChildren) {
    child.kill("SIGINT");
  }
  process.exit(0);
});
