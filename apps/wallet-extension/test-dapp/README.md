# Quantix Extension Test dApp

This page is a minimal local dApp to test the extension provider API:

- quantix_connect
- quantix_getActiveAddress
- quantix_signMessage
- quantix_sendTransaction
- quantix_contractCall
- quantix_contractSend

Also includes a dedicated **Token Tester (QRC-20 Native)** panel for end-to-end token method tests.

## Run

From workspace root:

```bash
cd apps/wallet-extension/test-dapp
python3 -m http.server 5501
```

Open:

- http://127.0.0.1:5501

## Before testing

1. Load extension unpacked from `apps/wallet-extension/dist`.
2. In extension settings, import wallet JSON and save RPC endpoint.
3. Ensure local node RPC is running at endpoint configured in extension.

## Notes

- If `window.quantix` is missing, check extension is enabled and can run on this page.
- For `quantix_sendTransaction` with `type=transfer`, field `to` is required.
- `Args` in Contract panel must be valid JSON array.
- `Amount`, `Fee`, and `Value` fields are interpreted as **QTX decimal** and auto-converted to base units (18 decimals).
- Use `raw:<integer>` when you want to pass exact base units directly.
	- Example: `raw:1000000000000000000`

## Token tester quick flow

1. Click `quantix_connect`.
2. Fill `Token Contract Address` with your token contract.
3. Click `Use Active as Owner`.
4. Fill `Recipient Address` and `Spender Address`.
5. Click `Run Read Test Suite` to verify:
	- `token_total_supply`
	- `token_balance_of(owner)`
	- `token_allowance(owner, spender)`
	- optional `token_balance_of(recipient)`

## Token write tests

- `token_transfer(to,amount)`
- `token_approve(spender,amount)`
- `token_transfer_from(from,to,amount)`
- `token_mint(to,amount)` (owner only)
- `token_burn(amount)`
- `token_config(key,value)` (owner only)

All token amount fields in the Token Tester are treated as token decimals and auto-converted using `Token Decimals`.
