# Quantix V2

Fresh-code TypeScript/Node research blockchain prototype.

## Scope (MVP)
- Post-quantum signature flow (adapter-based)
- Transfers + staking + unstaking + validator registration
- Deterministic state transitions
- Minimal node runtime loop

## Quick start
```bash
npm install
npm run dev:node
```

By default, the node starts JSON-RPC at `http://localhost:7331/rpc`.

## Multi-node devnet

Run a local 3-validator network from shared config:

```bash
npm run dev:devnet
```

Default validator config lives at `testnets/devnet/config.json`.

Each validator persists local node state under `testnets/devnet/data/<node-id>/node-state.json` by default.
Override per process with:

```bash
QTX_DATA_DIR=/absolute/path/to/node-data NODE_ID=validator-bob npm run dev:node
```

You can override with:

```bash
QTX_CONFIG_PATH=/absolute/path/to/config.json npm run dev:devnet
```

You can also run a single validator process by id:

```bash
NODE_ID=validator-bob npm run dev:node
```

## JSON-RPC Methods

- `qtx_getBalance(address)`
- `qtx_getBlockHead()`
- `qtx_getValidators()`
- `qtx_getMempool()`
- `qtx_submitTransaction(tx)`
- `qtx_markValidatorOffline(validatorId, offline)`
- `qtx_slashEquivocation(validatorId)`
- `qtx_produceBlock()`
- `qtx_seedTransfer(to, amount)`
- `qtx_getState()`

## RPC Error Codes

The node returns JSON-RPC 2.0 errors with deterministic codes for client branching.

| Code | Name | Meaning |
|---|---|---|
| -32700 | PARSE_ERROR | Invalid JSON payload |
| -32600 | INVALID_REQUEST | Invalid JSON-RPC envelope |
| -32601 | METHOD_NOT_FOUND | Unknown RPC method |
| -32602 | INVALID_PARAMS | Invalid parameter shape/value |
| -32603 | INTERNAL_ERROR | Unexpected server error |
| -32001 | VALIDATION_ERROR | Generic domain validation failure |
| -32004 | NOT_FOUND | Resource not found |
| -32010 | SIGNATURE_INVALID | Signature verification failed |
| -32011 | NONCE_STALE | Nonce is behind chain nonce |
| -32012 | NONCE_CONFLICT | Same sender+nonce already in mempool |
| -32013 | NONCE_SEQUENCE | Nonce is not the next expected value |

### Error response shape

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"error": {
		"code": -32012,
		"message": "transaction rejected: conflicting nonce ...",
		"data": {
			"category": "nonce",
			"nonce": 7,
			"from": "qtx1..."
		}
	}
}
```

### Example request

```bash
curl -s http://localhost:7331/rpc \
	-H 'content-type: application/json' \
	-d '{"jsonrpc":"2.0","id":1,"method":"qtx_getBlockHead","params":[]}'
```
