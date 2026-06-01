const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CONFIG_PATH = resolve(ROOT, "testnets/devnet/config.json");
const GENESIS_PATH = resolve(ROOT, "testnets/devnet/genesis.json");
const DATA_ROOT = resolve(ROOT, "testnets/devnet/data");
const RESET_MARKER = resolve(DATA_ROOT, ".pm2-reset-done");

function readSeedFromKeyFile(fileName, fallbackSeed) {
  const filePath = resolve(ROOT, fileName);
  if (!existsSync(filePath)) return fallbackSeed;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const seed = String(parsed.seed || "").trim();
    if (/^[0-9a-f]{64}$/i.test(seed)) return seed.toLowerCase();
  } catch {
    // ignore and use fallback
  }
  return fallbackSeed;
}

const validator1Seed = readSeedFromKeyFile(
  "wallet-validator1.key.json",
  "0000000000000000000000000000000000000000000000000000000000000011",
);
const validator2Seed = readSeedFromKeyFile(
  "wallet-validator2.key.json",
  "0000000000000000000000000000000000000000000000000000000000000012",
);
const validator3Seed = readSeedFromKeyFile(
  "wallet-validator3.key.json",
  "0000000000000000000000000000000000000000000000000000000000000013",
);
const validator4Seed = readSeedFromKeyFile(
  "wallet-validator4.key.json",
  "0000000000000000000000000000000000000000000000000000000000000014",
);

module.exports = {
  apps: [
    {
      name: "reset-devnet",
      cwd: ROOT,
      script: "bash",
      args: `-lc "npm run reset && touch '${RESET_MARKER}'"`,
      autorestart: false,
      max_restarts: 0,
    },
    {
      name: "seednode",
      cwd: ROOT,
      script: "bash",
      args: `-lc "while [ ! -f '${RESET_MARKER}' ]; do sleep 0.2; done; npm run dev:node"`,
      env: {
        NODE_ID: "seednode",
        QTX_RPC_PORT: "7330",
        QTX_CONFIG_PATH: CONFIG_PATH,
        QTX_GENESIS_PATH: GENESIS_PATH,
        QTX_DATA_DIR: resolve(DATA_ROOT, "seednode"),
      },
    },
    {
      name: "validator-1",
      cwd: ROOT,
      script: "bash",
      args: `-lc "while [ ! -f '${RESET_MARKER}' ]; do sleep 0.2; done; npm run dev:node"`,
      env: {
        NODE_ID: "validator-1",
        QTX_SEED_HEX: validator1Seed,
        QTX_RPC_PORT: "7341",
        QTX_CONFIG_PATH: CONFIG_PATH,
        QTX_GENESIS_PATH: GENESIS_PATH,
        QTX_DATA_DIR: resolve(DATA_ROOT, "validator-1"),
        QTX_BOOTSTRAP_RPC_ENDPOINTS: "http://127.0.0.1:7330/rpc,http://127.0.0.1:7342/rpc,http://127.0.0.1:7343/rpc",
      },
    },
    {
      name: "validator-2",
      cwd: ROOT,
      script: "bash",
      args: `-lc "while [ ! -f '${RESET_MARKER}' ]; do sleep 0.2; done; npm run dev:node"`,
      env: {
        NODE_ID: "validator-2",
        QTX_SEED_HEX: validator2Seed,
        QTX_RPC_PORT: "7342",
        QTX_CONFIG_PATH: CONFIG_PATH,
        QTX_GENESIS_PATH: GENESIS_PATH,
        QTX_DATA_DIR: resolve(DATA_ROOT, "validator-2"),
        QTX_BOOTSTRAP_RPC_ENDPOINTS: "http://127.0.0.1:7330/rpc,http://127.0.0.1:7341/rpc,http://127.0.0.1:7343/rpc",
      },
    },
    {
      name: "validator-3",
      cwd: ROOT,
      script: "bash",
      args: `-lc "while [ ! -f '${RESET_MARKER}' ]; do sleep 0.2; done; npm run dev:node"`,
      env: {
        NODE_ID: "validator-3",
        QTX_SEED_HEX: validator3Seed,
        QTX_RPC_PORT: "7343",
        QTX_CONFIG_PATH: CONFIG_PATH,
        QTX_GENESIS_PATH: GENESIS_PATH,
        QTX_DATA_DIR: resolve(DATA_ROOT, "validator-3"),
        QTX_BOOTSTRAP_RPC_ENDPOINTS: "http://127.0.0.1:7330/rpc,http://127.0.0.1:7341/rpc,http://127.0.0.1:7342/rpc",
      },
    },
    {
      name: "validator-4",
      cwd: ROOT,
      script: "bash",
      args: `-lc "while [ ! -f '${RESET_MARKER}' ]; do sleep 0.2; done; npm run dev:node"`,
      env: {
        NODE_ID: "validator-4",
        QTX_SEED_HEX: validator4Seed,
        QTX_RPC_PORT: "7344",
        QTX_CONFIG_PATH: CONFIG_PATH,
        QTX_GENESIS_PATH: GENESIS_PATH,
        QTX_DATA_DIR: resolve(DATA_ROOT, "validator-4"),
        QTX_BOOTSTRAP_RPC_ENDPOINTS: "http://127.0.0.1:7330/rpc,http://127.0.0.1:7341/rpc,http://127.0.0.1:7342/rpc,http://127.0.0.1:7343/rpc",
      },
    },
    {
      name: "explorer",
      cwd: ROOT,
      script: "bash",
      args: `-lc "while [ ! -f '${RESET_MARKER}' ]; do sleep 0.2; done; rm -rf apps/explorer/.next && npm run explorer:next:build && npm run -w @quantix/explorer start"`,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
    {
      name: "wallet",
      cwd: resolve(ROOT, "apps/wallet"),
      script: "bash",
      args: `-lc "while [ ! -f '${RESET_MARKER}' ]; do sleep 0.2; done; npm run dev"`,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
};
