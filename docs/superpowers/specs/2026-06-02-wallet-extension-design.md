# Wallet Extension Design (2026-06-02)

## Summary
Build a Chrome/Edge MV3 wallet extension with a popup landing view, activity logs, and a full settings page. The extension uses a Next.js static export UI, a background service worker for RPC and cryptography, and an encrypted account vault stored in chrome.storage.local. Accounts can be generated or imported, unlocked per session with a password. Activity logs are hybrid: remote (RPC) plus local records for outgoing transactions.

## Goals
- Chrome/Edge MV3 wallet extension with popup + settings pages.
- Popup landing shows address, balance, Send/Receive actions, and account switcher icon in the top-right.
- Activity logs page with hybrid data source (RPC + local).
- Settings page with RPC endpoint, network selection, lock timeout, and currency display.
- Encrypted vault stored in chrome.storage.local, unlocked per session.
- Generate and import accounts in settings (not in account dropdown).

## Non-Goals (Phase A)
- Full dApp provider injection (permissions UI only scaffolded).
- Transaction fee estimation and multi-step send confirmations (Phase B).
- QR receive and onboarding flow polish (Phase C).

## UX and Navigation
- **Popup landing**: address (copy), balance, connection status, Send and Receive buttons.
- **Account switcher**: icon in top-right opens dropdown with accounts (name/address/balance). No add/import actions here.
- **Activity**: separate view within popup (tab or segmented control).
- **Settings page**: full settings and account management (generate/import, remove, rename).
- **Unlock flow**: popup always prompts password on open; after unlock, all tabs available. When popup closes, session ends.

## Data Model and Storage
- **Vault storage**: encrypted JSON payload in chrome.storage.local.
- **Active address**: `quantix_active_address_v1` in chrome.storage.local.
- **Accounts map**: `quantix_accounts_v1` in chrome.storage.local (encrypted).
- **RPC endpoint**: `quantix_rpc_endpoint_v1` in chrome.storage.local.
- **Permissions map**: `quantix_origin_permissions_v1` (stored, UI not exposed in phase A).
- **Activity log**: local append-only list for outgoing txs; merge with RPC history if available.

## Encryption
- Password-based encryption per session.
- Decrypted vault lives only in memory (background service worker) after unlock.
- On lock or popup close, clear decrypted keys from memory.
- Use Web Crypto for PBKDF2 + AES-GCM (exact params defined during implementation).

## RPC and Activity
- Background service worker performs all RPC calls.
- UI sends `chrome.runtime.sendMessage` requests.
- Activity logs:
  - Try RPC history (if node provides endpoint) for inbound/outbound.
  - Always add local records for outgoing txs submitted by extension.
  - Merge and de-dup by tx hash, sort by timestamp descending.

## Architecture
- **UI (Next.js static export)**
  - `/popup`: landing + activity views.
  - `/settings`: full settings and account management.
- **Background service worker**
  - RPC proxy
  - unlock/lock state
  - encryption/decryption
  - tx submission
- **Storage adapter**
  - chrome.storage.local abstraction used by background and UI.

## Manifest and Build
- MV3 manifest:
  - `action.default_popup` => `popup/index.html`
  - `options_page` => `settings/index.html`
  - `background.service_worker` => `background/index.js`
- Next.js `output: "export"` and build step to copy static output into extension dist.
- CSP compatible with MV3 (no inline scripts; externalized assets only).

## Error Handling
- RPC errors shown in UI (status banner + inline errors).
- Unlock failures are explicit and do not leak partial state.
- Activity fetch failures fall back to local logs only.

## Testing
- Unit tests for encryption/decryption and storage adapter.
- RPC client tests with mocked fetch.
- Manual test checklist:
  - Unlock flow
  - Generate/import account
  - Send and receive actions (Phase B)
  - Activity merge order
  - Settings persistence

## Open Questions
- Exact RPC endpoint for transaction history (if missing, define in node later).
- Currency display source (fiat conversion not included in Phase A).
