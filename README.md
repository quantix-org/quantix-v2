# Quantix V2

> **Post-quantum blockchain research prototype — ML-DSA-87 (Dilithium5) signatures, BFT consensus, TypeScript monorepo.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Post-Quantum](https://img.shields.io/badge/Signatures-ML--DSA--87-purple)](https://csrc.nist.gov/projects/post-quantum-cryptography)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

Quantix V2 is a research-grade, full-stack blockchain prototype built entirely in TypeScript. Every transaction is signed with **ML-DSA-87 (CRYSTALS-Dilithium level 5)** — a NIST-standardised post-quantum digital signature algorithm. The consensus algorithm is a simple BFT variant (`qtx-bft`) with a 4-second block interval and `floor(2n/3)+1` quorum.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Quick Start — 4-Node Devnet](#quick-start--4-node-devnet)
6. [Running a Single Node](#running-a-single-node)
7. [Multi-Node Devnets](#multi-node-devnets)
8. [Permissionless Validator Joining](#permissionless-validator-joining)
9. [Block Explorer](#block-explorer)
10. [Wallet CLI](#wallet-cli)
11. [Transaction Types](#transaction-types)
12. [JSON-RPC API](#json-rpc-api)
13. [RPC Error Codes](#rpc-error-codes)
14. [Environment Variables](#environment-variables)
15. [SDK Usage](#sdk-usage)
16. [Protocol Constants](#protocol-constants)
17. [Tests](#tests)
18. [npm Scripts](#npm-scripts)
19. [Genesis File Format](#genesis-file-format)

---

## Features

- **Post-quantum signatures** — ML-DSA-87 (Dilithium5) via [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum)
- **BFT consensus** — `qtx-bft` with `floor(2n/3)+1` quorum, equivocation slashing (10%), missed-block slash threshold (3)
- **Four transaction types** — transfer, stake, unstake, validator_register
- **Permissionless validator joining** — any node can join with `QTX_SEED_HEX` without being listed in config
- **JSON-RPC 2.0 API** — complete, deterministic error codes
- **Block explorer** — Etherscan-like SPA (dark theme, live refresh, block/tx/address/validator views)
- **Wallet CLI** — full-featured terminal wallet (`qtx`)
- **TypeScript SDK** — `@quantix/sdk` for building apps and integrations
- **Monorepo** — npm workspaces, strict TypeScript, shared packages

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  apps/node                        │
│  main.ts — node runtime, BFT loop, RPC server     │
│  config.ts / genesis.ts — devnet bootstrap        │
│  storage.ts — JSON-file persistence (NodeStore)   │
│  tx-policy.ts — mempool validation                │
│  rpc-errors.ts — typed error codes                │
└──────────┬───────────────────────────────────────┘
           │ imports
┌──────────▼──────────────────────────────────────┐
│              packages/protocol                   │
│  types.ts — Transaction, ValidatorState, etc.    │
│  constants.ts — DEFAULT_PROTOCOL_CONFIG          │
│  consensus.ts — runConsensusRound                │
│  transactions.ts — apply/validate tx logic       │
│  state.ts — deterministic state transitions      │
└──────────┬──────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────┐
│              packages/crypto                     │
│  ML-DSA-87 keygen, sign, verify                  │
│  deriveAddressFromPublicKey → "qtx1…" prefix     │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│              packages/sdk                        │
│  buildTransferTx / buildStakeTx / …              │
│  getBalance / getBlock / submitTx / …            │
│  RpcError — typed JSON-RPC error class           │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│              tools/                              │
│  explorer/explorer.ts — HTTP server + HTML SPA   │
│  wallet/qtx.ts        — CLI wallet               │
│  wallet/spam-tx.ts    — load-testing helper      │
│  devnet/run-3node.ts  — 3-validator launcher     │
│  devnet/run-4node.ts  — 4-validator launcher     │
└─────────────────────────────────────────────────┘
```

---

## Project Structure

```
quantix-v2/
├── apps/
│   └── node/src/
│       ├── main.ts          # Node runtime & BFT loop
│       ├── config.ts        # Config/genesis loaders
│       ├── genesis.ts       # Genesis file parsing
│       ├── storage.ts       # Persistent node state (NodeStore)
│       ├── tx-policy.ts     # Mempool nonce/validation policy
│       ├── rpc-client.ts    # Internal peer RPC helper
│       └── rpc-errors.ts    # Typed RPC error codes
│
├── packages/
│   ├── crypto/src/index.ts  # ML-DSA-87 key generation, sign, verify, address
│   ├── network/             # P2P networking primitives
│   ├── protocol/src/
│   │   ├── types.ts         # Core TypeScript types
│   │   ├── constants.ts     # DEFAULT_PROTOCOL_CONFIG
│   │   ├── state.ts         # Genesis state creation
│   │   ├── consensus.ts     # BFT consensus round
│   │   └── transactions.ts  # Transaction application & validation
│   └── sdk/src/index.ts     # Client SDK (builders + queries)
│
├── tools/
│   ├── devnet/
│   │   ├── run-3node.ts     # 3-validator devnet
│   │   └── run-4node.ts     # 4-validator devnet
│   ├── explorer/
│   │   └── explorer.ts      # Block explorer server
│   └── wallet/
│       ├── qtx.ts           # Wallet CLI
│       └── spam-tx.ts       # Transaction load tester
│
├── testnets/
│   ├── devnet/              # 3-node devnet config + genesis
│   │   ├── config.json
│   │   ├── genesis.json
│   │   └── data/            # Persistent node state (git-ignored)
│   └── devnet-4/            # 4-node devnet config + genesis
│       ├── config.json
│       └── genesis.json
│
├── tests/                   # Integration test suites
│   ├── devnet-4node.test.ts
│   ├── devnet-convergence.test.ts
│   ├── node-tx-policy.test.ts
│   ├── protocol-consensus.test.ts
│   └── sdk.test.ts
│
└── package.json             # Workspace root — all npm scripts here
```

---

## Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10 (workspace support)
- `tsx` is installed as a dev dependency — no global install needed

---

## Quick Start — 4-Node Devnet

```bash
git clone <repo-url> quantix-v2
cd quantix-v2
npm install

# Start 4-validator devnet (alice :7341, bob :7342, carol :7343, dave :7344)
npm run dev:devnet4

# In a second terminal — open the block explorer
npm run explorer:devnet4
```

Explorer opens at **http://localhost:8080** — blocks appear every 4 seconds.

---

## Running a Single Node

```bash
npm run dev:node
```

Starts a single node with `NODE_ID=validator-alice` on port **7331** using the 3-node devnet config (`testnets/devnet/`).

Override the node identity or port:

```bash
NODE_ID=validator-bob QTX_RPC_PORT=7332 npm run dev:node
```

---

## Multi-Node Devnets

### 3-node devnet (ports 7331 / 7332 / 7333)

```bash
npm run dev:devnet
```

Config: `testnets/devnet/config.json`
Genesis: `testnets/devnet/genesis.json`

### 4-node devnet (ports 7341 / 7342 / 7343 / 7344)

```bash
npm run dev:devnet4
```

Config: `testnets/devnet-4/config.json`
Genesis: `testnets/devnet-4/genesis.json`

Validators: **alice**, **bob**, **carol**, **dave** — each starts with 1000 QTX balance and 100 QTX initial stake.

### Reset devnet state

```bash
npm run reset
```

Deletes all data directories under `testnets/*/data/` so the chain restarts from genesis.

### Override config paths

```bash
QTX_CONFIG_PATH=/path/to/config.json \
QTX_GENESIS_PATH=/path/to/genesis.json \
npm run dev:node
```

---

## Permissionless Validator Joining

Any node can join an existing network without being listed in `config.json`. The node derives its identity solely from a 64-character hex seed and connects to the bootstrap peers defined in the genesis file.

```bash
QTX_SEED_HEX=aabbccdd...64hexchars \
QTX_RPC_PORT=7350 \
QTX_STAKE_AMOUNT=64 \
QTX_GENESIS_PATH=testnets/devnet-4/genesis.json \
npm run dev:node
```

| Variable | Purpose |
|---|---|
| `QTX_SEED_HEX` | Deterministic 32-byte seed for ML-DSA-87 key generation. The node's address and validator ID derive from this. **Keep secret.** |
| `QTX_RPC_PORT` | **Required** for external validators (no default available from config). |
| `QTX_STAKE_AMOUNT` | QTX to self-stake on startup (default: `32`, the minimum). |

The node auto-submits a `validator_register` transaction and joins the active validator set once its stake meets the minimum threshold.

> **Funding**: External validator addresses are not pre-funded in genesis. Send QTX to the derived address (use `npm run qtx -- address --key <keyfile>`) before the node attempts to self-stake.

---

## Block Explorer

A lightweight Etherscan-inspired SPA served directly from the explorer process.

```bash
# Point at 4-node devnet
npm run explorer:devnet4

# Point at 3-node devnet
npm run explorer:devnet

# Custom RPC endpoint and port
npm run explorer -- http://localhost:7341/rpc 9090
```

Default URL: **http://localhost:8080**

### Explorer pages

| Route | Description |
|---|---|
| `#/` | Home — latest blocks, chain stats, live mempool count |
| `#/block/<height>` | Block detail — hash, transactions, prev/next navigation |
| `#/tx/<hash>` | Transaction detail — type, status, sender, amount, fee |
| `#/address/<addr>` | Address detail — balance, staked amount, nonce, tx history |
| `#/validators` | Validators — id, owner, stake, status, missed blocks |

The page auto-refreshes every **4 seconds** and shows a live status indicator.

---

## Wallet CLI

```bash
npm run qtx -- <command> [options]
```

All commands default to `--rpc http://localhost:7331/rpc` and `--key ./wallet.key.json`.

### Commands

| Command | Description |
|---|---|
| `new` | Generate a new ML-DSA-87 wallet and save to keyfile |
| `import <seed-hex>` | Import wallet from a 64-char hex seed |
| `address` | Print the QTX address from a keyfile |
| `balance <address>` | Query balance, staked amount, and nonce |
| `send <to> <amount>` | Transfer QTX to another address |
| `stake <amount>` | Stake QTX (self-delegation) |
| `unstake <amount>` | Unstake QTX (subject to cooldown) |
| `validator register <id> <amount>` | Register as a validator with a given stake |
| `block <height\|latest>` | Look up a block by height or `latest` |
| `tx <hash>` | Look up a transaction by hash |
| `chain` | Show chain info (chainId, height, validators, etc.) |
| `mempool` | Show pending (unconfirmed) transactions |
| `validators` | List all registered validators and their status |

### Global options

| Flag | Default | Description |
|---|---|---|
| `--rpc <url>` | `http://localhost:7331/rpc` | Node RPC endpoint |
| `--key <file>` | `./wallet.key.json` | Path to wallet keyfile |
| `--fee <qtx>` | `0` | Fee to attach to the transaction |
| `--output <file>` | `./wallet.key.json` | Output path for `new` / `import` |

### Examples

```bash
# Create a new wallet
npm run qtx -- new --output ~/.qtx/wallet.key.json

# Check balance
npm run qtx -- balance qtx1abc123... --rpc http://localhost:7341/rpc

# Send 10 QTX
npm run qtx -- send qtx1recipient... 10 --key ~/.qtx/wallet.key.json

# Stake 50 QTX
npm run qtx -- stake 50 --key ~/.qtx/wallet.key.json

# Register as a validator with 32 QTX stake
npm run qtx -- validator register my-validator-id 32 --key ~/.qtx/wallet.key.json

# View latest block
npm run qtx -- block latest
```

---

## Transaction Types

| Type | Description | Required Fields |
|---|---|---|
| `transfer` | Send QTX to another address | `from`, `to`, `amount`, `nonce`, `fee` |
| `stake` | Lock QTX as validator stake | `from`, `amount`, `nonce`, `fee` |
| `unstake` | Unlock staked QTX (cooldown applies) | `from`, `amount`, `nonce`, `fee` |
| `validator_register` | Register a validator identity | `from`, `validatorId`, `amount`, `nonce`, `fee` |

All transactions must include:
- `signerPublicKey` — hex-encoded ML-DSA-87 public key
- `signature` — ML-DSA-87 signature over the canonical signing payload

Amounts and fees are **raw integer strings** when sent over JSON-RPC. Devnet genesis balances are expressed in whole QTX units for readability (the chain uses integer arithmetic with no decimal shift at the protocol level).

---

## JSON-RPC API

All calls use `POST /rpc` with a JSON-RPC 2.0 envelope:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "qtx_methodName", "params": [...] }
```

### `qtx_getChainInfo`

Returns chain metadata and current node status.

```bash
curl -s http://localhost:7341/rpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"qtx_getChainInfo","params":[]}'
```

Response fields: `chainId`, `name`, `nativeDenom`, `decimals`, `consensus`, `nodeId`, `height`, `blockIntervalMs`, `activeValidators`, `totalValidators`, `mempoolSize`

### `qtx_getLatestBlock`

Returns the latest committed block (`height`, `hash`).

### `qtx_getBlock(height)`

Returns a specific block by height. Throws `NOT_FOUND` (-32004) if the block does not exist.

```json
{ "method": "qtx_getBlock", "params": [42] }
```

### `qtx_getBalance(address)`

Returns balance, staked amount, and nonce for an address.

```json
{ "method": "qtx_getBalance", "params": ["qtx1abc123..."] }
```

Response: `{ address, balance, staked, nonce }` — `balance` and `staked` are decimal strings.

### `qtx_getTransaction(hash)`

Returns a transaction by its hash.

Response: `{ hash, status, blockHeight, blockHash, type, from, to?, validatorId?, amount, fee, nonce }`

### `qtx_getValidators`

Returns all registered validators as an array of `{ id, owner, stake, active, missedBlocks, slashed }`.

### `qtx_getMempool`

Returns currently pending (unconfirmed) transactions.

### `qtx_getPeers`

Returns peers known to this node as an array of `{ id, endpoint }`.

### `qtx_getState`

Returns the full protocol state snapshot (accounts map, validators, block height).

### `qtx_submitTransaction(tx)`

Submit a signed transaction. Returns `{ txHash }` on success.

```json
{
  "method": "qtx_submitTransaction",
  "params": [{
    "type": "transfer",
    "from": "qtx1...",
    "to": "qtx1...",
    "nonce": 1,
    "amount": "100",
    "fee": "1",
    "signerPublicKey": "<hex>",
    "signature": "<hex>"
  }]
}
```

---

## RPC Error Codes

| Code | Name | Meaning |
|---|---|---|
| -32700 | `PARSE_ERROR` | Invalid JSON payload |
| -32600 | `INVALID_REQUEST` | Invalid JSON-RPC envelope |
| -32601 | `METHOD_NOT_FOUND` | Unknown RPC method |
| -32602 | `INVALID_PARAMS` | Invalid parameter shape or value |
| -32603 | `INTERNAL_ERROR` | Unexpected server error |
| -32001 | `VALIDATION_ERROR` | Generic domain validation failure |
| -32004 | `NOT_FOUND` | Resource not found (block, tx, address) |
| -32010 | `SIGNATURE_INVALID` | ML-DSA-87 signature verification failed |
| -32011 | `NONCE_STALE` | Nonce is behind the on-chain nonce |
| -32012 | `NONCE_CONFLICT` | Same sender+nonce already in mempool |
| -32013 | `NONCE_SEQUENCE` | Nonce is not the next expected value |

### Error response shape

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32012,
    "message": "transaction rejected: conflicting nonce 7 from qtx1...",
    "data": {
      "category": "nonce",
      "nonce": 7,
      "from": "qtx1..."
    }
  }
}
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ID` | `validator-alice` | Identity of this node (must match a key in `config.json`, unless `QTX_SEED_HEX` is set) |
| `QTX_SEED_HEX` | — | 64-char hex seed for permissionless external validator mode. When set, `NODE_ID` is ignored. |
| `QTX_RPC_PORT` | from `config.json` | JSON-RPC listen port. **Required** when using `QTX_SEED_HEX`. |
| `QTX_STAKE_AMOUNT` | `32` | QTX to self-stake on startup (external validators only) |
| `QTX_DATA_DIR` | `testnets/devnet/data/<NODE_ID>` | Directory for persistent node state |
| `QTX_CONFIG_PATH` | `testnets/devnet/config.json` | Path to devnet config JSON |
| `QTX_GENESIS_PATH` | `testnets/devnet/genesis.json` | Path to genesis JSON |
| `QTX_BLOCK_INTERVAL_MS` | from genesis | Override block production interval in milliseconds |

---

## SDK Usage

```typescript
import {
  generateKeyPair,
  deriveAddress,
  buildTransferTx,
  buildStakeTx,
  buildValidatorRegisterTx,
  getBalance,
  getNextNonce,
  getLatestBlock,
  getValidators,
  submitTx,
  RpcError,
} from "@quantix/sdk";

const RPC = "http://localhost:7341/rpc";

// Generate a new wallet
const keys = generateKeyPair();                       // ML-DSA-87 key pair
const address = deriveAddress(keys.publicKey);        // "qtx1..."

// Deterministic wallet from a known seed
const deterministicKeys = generateKeyPair("aabbccdd...64hexchars");

// Query balance
const { balance, staked, nonce } = await getBalance(RPC, address);

// Build and submit a transfer
const nextNonce = await getNextNonce(RPC, address);
const tx = buildTransferTx({
  from: address,
  to: "qtx1recipient...",
  amount: 50n,
  fee: 1n,
  nonce: nextNonce,
  signerPublicKey: keys.publicKey,
  privateKey: keys.privateKey,
});
const { txHash } = await submitTx(RPC, tx);

// Handle RPC errors
try {
  await submitTx(RPC, tx);
} catch (e) {
  if (e instanceof RpcError) {
    console.error(`RPC error ${e.code}: ${e.message}`);
  }
}
```

### Transaction builders

| Function | Tx type | Description |
|---|---|---|
| `buildTransferTx(params)` | `transfer` | Send QTX to another address |
| `buildStakeTx(params)` | `stake` | Stake QTX |
| `buildUnstakeTx(params)` | `unstake` | Unstake QTX |
| `buildValidatorRegisterTx(params)` | `validator_register` | Register a validator |

All builders return a fully signed `Transaction` ready to pass to `submitTx`.

---

## Protocol Constants

These defaults are used by the devnet genesis files. Override per-network in `genesis.json → protocolParams`.

| Parameter | Devnet value | Description |
|---|---|---|
| `minValidatorStake` | `32` QTX | Minimum stake to become an active validator |
| `unstakeCooldownBlocks` | `20` blocks | Blocks to wait before unstaked funds are released |
| `baseFee` | `1` QTX | Minimum transaction fee |
| `maxActiveValidators` | `0` (unlimited) | Cap on active validator set size (`0` = no cap) |
| `epochLength` | `0` (immediate) | Blocks per epoch for validator set rotation (`0` = activate immediately) |
| `blockIntervalMs` | `4000` ms | Target time between blocks |
| `quorumRule` | `floor(2n/3)+1` | BFT quorum threshold |
| `maxMissedBlocksBeforeSlash` | `3` | Consecutive missed blocks before slashing |
| `equivocationSlashPercent` | `10%` | Stake penalty for double-signing |

### Address format

```
qtx1 + SHA-256(publicKey_hex)[0..38]
```

Addresses are 42 characters, always prefixed with `qtx1`.

---

## Tests

```bash
npm run test
```

Runs all integration tests via Vitest. Tests spin up in-process node instances — no external devnet required.

### Test suites

| File | What it tests |
|---|---|
| `tests/protocol-consensus.test.ts` | BFT consensus round logic, quorum rules, slashing |
| `tests/node-tx-policy.test.ts` | Mempool nonce policy — stale, conflict, sequence |
| `tests/devnet-4node.test.ts` | 4-node devnet — block production, tx submission |
| `tests/devnet-convergence.test.ts` | Network convergence after a node rejoins |
| `tests/sdk.test.ts` | SDK builder and query functions |

---

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev:node` | Start a single node (`validator-alice`, port 7331) |
| `npm run dev:devnet` | Start 3-node devnet (ports 7331–7333) |
| `npm run dev:devnet4` | Start 4-node devnet (ports 7341–7344) |
| `npm run explorer` | Start explorer — args: `<rpc_url> <port>` |
| `npm run explorer:devnet` | Explorer → `http://localhost:7331/rpc` on port 8080 |
| `npm run explorer:devnet4` | Explorer → `http://localhost:7341/rpc` on port 8080 |
| `npm run qtx` | Wallet CLI — pass commands after `--` |
| `npm run spam-tx` | Submit rapid test transactions to the devnet |
| `npm run test` | Run all integration tests |
| `npm run build` | Compile all packages and apps |
| `npm run typecheck` | Type-check without emitting files |
| `npm run lint` | Lint with ESLint |
| `npm run reset` | Delete all devnet data directories |

---

## Genesis File Format

```json
{
  "meta": { "format": "quantix-genesis/v1", "network": "devnet-4" },
  "chain": {
    "chainId": "quantix-devnet-4",
    "nativeDenom": "QTX",
    "decimals": 18
  },
  "consensus": {
    "algorithm": "qtx-bft",
    "blockIntervalMs": 4000,
    "quorumRule": "floor(2n/3)+1",
    "maxMissedBlocksBeforeSlash": 3,
    "equivocationSlashPercent": 10
  },
  "protocolParams": {
    "minValidatorStake": "32",
    "unstakeCooldownBlocks": 20,
    "baseFee": "1",
    "epochLength": 10,
    "maxActiveValidators": 10
  },
  "network": {
    "peerDiscovery": {
      "bootstrapNodes": [
        { "id": "validator-alice", "rpcEndpoint": "http://127.0.0.1:7341/rpc" }
      ]
    },
    "timeouts": { "peerRpcMs": 2500, "syncIntervalMs": 8000 }
  },
  "genesisState": {
    "accounts": [
      { "address": "qtx1...", "balance": "1000000" }
    ]
  }
}
```

---

## License

MIT
