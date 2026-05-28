import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface DevnetConfig {
  validators: Array<{
    id: string;
    rpcPort: number;
  }>;
}

const configPath = resolve(process.cwd(), process.env.QTX_CONFIG_PATH ?? "testnets/devnet-4/config.json");
const genesisPath = resolve(process.cwd(), process.env.QTX_GENESIS_PATH ?? "testnets/devnet-4/genesis.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as DevnetConfig;

const children = config.validators.map((validator) => {
  const child = spawn(
    "npm",
    ["run", "-w", "@quantix/node", "dev"],
    {
      env: {
        ...process.env,
        NODE_ID: validator.id,
        QTX_RPC_PORT: String(validator.rpcPort),
        QTX_CONFIG_PATH: configPath,
        QTX_GENESIS_PATH: genesisPath,
      },
      stdio: "inherit",
    },
  );

  child.on("exit", (code) => {
    console.log(`[devnet-4] ${validator.id} exited with code ${code ?? 0}`);
  });

  return child;
});

process.on("SIGINT", () => {
  for (const child of children) {
    child.kill("SIGINT");
  }
  process.exit(0);
});
