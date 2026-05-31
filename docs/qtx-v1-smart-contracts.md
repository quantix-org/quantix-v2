# Quantix Smart Contracts (`qtx-v1`)

This document defines the current `qtx-v1` smart-contract format and execution rules in Quantix.

## Scope

- Quantix provides a deterministic smart-contract engine.
- Contract logic is authored by users through `qtx-v1` method programs.
- This is not EVM/Solidity compatible.

## Deploy Payload

A `contract_deploy` transaction carries `contractCode` for the contract program.

`qtx-v1` program shape:

```json
{
  "vm": "qtx-v1",
  "methods": {
    "setValue": [
      { "op": "set", "key": "value", "arg": 0 },
      { "op": "return", "value": "ok" }
    ]
  }
}
```

Notes:
- RPC (`qtx_sendTransaction`) requires `contractCode` as even-length hex.
- Protocol accepts plain JSON string or hex-encoded UTF-8 JSON.
- Contract addresses must start with `qtxContract`.

## Instruction Set

Allowed opcodes:
- `set`: write storage key
- `add`: add numeric value to storage key
- `delete`: remove storage key
- `emit`: create contract event
- `return`: set return payload

Instruction fields:
- `op`: opcode name
- `key`: storage key for `set` / `add` / `delete`
- `arg`: optional argument index from call args (for dynamic input)
- `value`: literal fallback value
- `name`: event name for `emit`
- `data`: event payload for `emit`

Value resolution:
- If `arg` is a valid index, runtime uses `args[arg]`.
- Otherwise runtime uses `value`.

## Validation Rules (Deploy Time)

`qtx-v1` deploy is rejected when:
- `vm` is not `qtx-v1`
- `methods` is missing or not an object
- no methods are defined
- method count exceeds `128`
- a method program is not an array
- instruction count in a method exceeds `256`
- instruction opcode is not in the allowed set

## Gas Rules

For `contract_call`, required gas is:

$$
\text{requiredGas} = \text{baseContractGas} + \text{vmInstructionGas}
$$

Where:

$$
\text{vmInstructionGas} = 10000 + \sum \left(800 + \mathbb{1}_{emit}\cdot 200 + \mathbb{1}_{storageWrite}\cdot 150\right)
$$

- `storageWrite` applies to `set`, `add`, `delete`.
- If `gasLimit < requiredGas`, the call is rejected with out-of-gas.

## SDK Helpers

Use SDK helpers to author and encode `qtx-v1` safely:

- `createQtxVmV1Contract(methods)`
- `stringifyQtxVmV1Contract(contract)`
- `encodeQtxVmV1ContractHex(contract)`
- `buildQtxVmV1DeployTx(params)`
- `buildQtxVmV1CallTx(params)`
- `callQtxVmV1Decoded(rpcEndpoint, params)`
- `encodeUtf8Hex(text)` / `decodeUtf8Hex(hex)`

Example:

```ts
import {
  createQtxVmV1Contract,
  buildQtxVmV1DeployTx,
  buildQtxVmV1CallTx,
  callQtxVmV1Decoded,
} from "@quantix/sdk";

const contract = createQtxVmV1Contract({
  setValue: [
    { op: "set", key: "value", arg: 0 },
    { op: "return", value: "ok" },
  ],
});

const tx = buildQtxVmV1DeployTx({
  chainId: "quantix-devnet",
  from,
  nonce,
  amount: 0n,
  signerPublicKey,
  privateKey,
  gasLimit: 200000,
  maxFeePerGas: 1n,
  value: 0n,
  salt: "my-contract-v1",
  contract,
});

const callTx = buildQtxVmV1CallTx({
  chainId: "quantix-devnet",
  from,
  nonce: nonce + 1,
  amount: 0n,
  signerPublicKey,
  privateKey,
  contractAddress: "qtxContract...",
  method: "setValue",
  args: [123],
  gasLimit: 200000,
  maxFeePerGas: 1n,
  value: 0n,
});

const simulated = await callQtxVmV1Decoded("http://localhost:7330/rpc", {
  chainId: "quantix-devnet",
  from,
  nonce: nonce + 2,
  amount: 0n,
  signerPublicKey,
  privateKey,
  contractAddress: "qtxContract...",
  method: "setValue",
  args: [123],
  gasLimit: 200000,
  maxFeePerGas: 1n,
  value: 0n,
});
```

## Compatibility

Native runtime methods (for compatibility/prototyping) and `qtx-v1` user-defined methods can coexist. For user-custom logic, prefer `qtx-v1`.

## Wallet CLI Wiring

The wallet CLI is wired to these helpers so operators can run contract flows without writing custom scripts.

Commands:
- `qtx contract deploy-v1 <contract-json-file> --key <file> [--gas <int>] [--salt <text>]`
- `qtx contract call <contract-address> <method> [args-json] --key <file> [--gas <int>]`
- `qtx contract simulate <contract-address> <method> [args-json] --key <file> [--gas <int>]`

Examples:

```bash
npm run qtx -- contract deploy-v1 ./contract.qtxv1.json --key wallet.key.json --rpc http://localhost:7330/rpc --gas 320000
npm run qtx -- contract call qtxContract... setValue '[123]' --key wallet.key.json --rpc http://localhost:7330/rpc --gas 300000
npm run qtx -- contract simulate qtxContract... getValue '[]' --key wallet.key.json --rpc http://localhost:7330/rpc --gas 300000
```
