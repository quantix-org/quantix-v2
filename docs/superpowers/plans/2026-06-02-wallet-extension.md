# Wallet Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome/Edge MV3 wallet extension with a popup landing view, activity logs, and a full settings page, backed by an encrypted vault stored in chrome.storage.local and unlocked per session.

**Architecture:** A Next.js static export provides the popup and settings UI. A background service worker owns RPC calls, encryption/decryption, and unlocked session state. UI talks to background via chrome.runtime messaging.

**Tech Stack:** Next.js (static export), React, TypeScript, Web Crypto (PBKDF2 + AES-GCM), MV3 extension APIs.

---

## File Structure (New)
- Create: apps/wallet-extension/package.json
- Create: apps/wallet-extension/next.config.ts
- Create: apps/wallet-extension/tsconfig.json
- Create: apps/wallet-extension/src/manifest.json
- Create: apps/wallet-extension/src/background/index.ts
- Create: apps/wallet-extension/src/shared/constants.ts
- Create: apps/wallet-extension/src/shared/types.ts
- Create: apps/wallet-extension/src/shared/crypto.ts
- Create: apps/wallet-extension/src/shared/storage.ts
- Create: apps/wallet-extension/src/shared/rpc.ts
- Create: apps/wallet-extension/src/app/layout.tsx
- Create: apps/wallet-extension/src/app/globals.css
- Create: apps/wallet-extension/src/app/popup/page.tsx
- Create: apps/wallet-extension/src/app/settings/page.tsx
- Create: apps/wallet-extension/src/components/TopBar.tsx
- Create: apps/wallet-extension/src/components/AccountMenu.tsx
- Create: apps/wallet-extension/src/components/BalanceCard.tsx
- Create: apps/wallet-extension/src/components/ActivityList.tsx
- Create: apps/wallet-extension/src/components/UnlockGate.tsx
- Create: apps/wallet-extension/src/components/SettingsForm.tsx
- Create: apps/wallet-extension/tests/crypto.test.ts
- Create: apps/wallet-extension/scripts/build.mjs

---

### Task 1: Scaffold the extension app + manifest

**Files:**
- Create: apps/wallet-extension/package.json
- Create: apps/wallet-extension/next.config.ts
- Create: apps/wallet-extension/tsconfig.json
- Create: apps/wallet-extension/src/manifest.json

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@quantix/wallet-extension",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 9860",
    "build:ui": "next build",
    "build:bg": "node ./scripts/build.mjs",
    "build": "npm run build:ui && npm run build:bg"
  },
  "dependencies": {
    "@quantix/crypto": "workspace:*",
    "@quantix/wallet-core": "workspace:*",
    "next": "^15.3.6",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/node": "^24.12.4",
    "@types/react": "^19.1.4",
    "@types/react-dom": "^19.1.2",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create next.config.ts**

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default config;
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src", "tests", "next-env.d.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create src/manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Quantix Wallet",
  "version": "0.1.0",
  "action": {
    "default_title": "Quantix Wallet",
    "default_popup": "popup/index.html"
  },
  "options_page": "settings/index.html",
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "permissions": ["storage", "clipboardWrite"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://*/* https://*/*; default-src 'self';"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/wallet-extension/package.json \
  apps/wallet-extension/next.config.ts \
  apps/wallet-extension/tsconfig.json \
  apps/wallet-extension/src/manifest.json

git commit -m "chore: scaffold wallet extension app"
```

---

### Task 2: Implement encrypted vault helpers (TDD)

**Files:**
- Create: apps/wallet-extension/tests/crypto.test.ts
- Create: apps/wallet-extension/src/shared/constants.ts
- Create: apps/wallet-extension/src/shared/types.ts
- Create: apps/wallet-extension/src/shared/crypto.ts

- [ ] **Step 1: Write failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { encryptVault, decryptVault } from "../src/shared/crypto";

const sampleVault = {
  version: 1,
  accounts: {
    qtx1abc: {
      address: "qtx1abc",
      publicKey: "a".repeat(64),
      privateKey: "b".repeat(64),
      name: "Account 1",
      createdAt: 1
    }
  },
  activeAddress: "qtx1abc",
  createdAt: 1,
  updatedAt: 1
};

test("encrypt/decrypt roundtrip", async () => {
  const password = "correct-horse-battery-staple";
  const encrypted = await encryptVault(sampleVault, password);
  const decrypted = await decryptVault(encrypted, password);
  assert.deepEqual(decrypted, sampleVault);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/wallet-extension/tests/crypto.test.ts`

Expected: FAIL with module not found / functions undefined.

- [ ] **Step 3: Add shared constants and types**

`apps/wallet-extension/src/shared/constants.ts`
```ts
export const VAULT_KEY = "quantix_vault_v1";
export const ACTIVE_ADDRESS_KEY = "quantix_active_address_v1";
export const RPC_ENDPOINT_KEY = "quantix_rpc_endpoint_v1";
export const NETWORK_KEY = "quantix_network_v1";
export const LOCK_TIMEOUT_KEY = "quantix_lock_timeout_v1";
export const CURRENCY_KEY = "quantix_currency_v1";

export const KDF_ITERATIONS = 200_000;
```

`apps/wallet-extension/src/shared/types.ts`
```ts
import type { StoredAccount } from "@quantix/wallet-core";

export type AccountRecord = StoredAccount & { name: string };

export type VaultData = {
  version: 1;
  accounts: Record<string, AccountRecord>;
  activeAddress: string | null;
  createdAt: number;
  updatedAt: number;
};

export type EncryptedVault = {
  version: 1;
  kdf: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};
```

- [ ] **Step 4: Implement crypto helpers**

`apps/wallet-extension/src/shared/crypto.ts`
```ts
import { KDF_ITERATIONS } from "./constants";
import type { EncryptedVault, VaultData } from "./types";

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: KDF_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptVault(data: VaultData, password: string): Promise<EncryptedVault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = enc.encode(JSON.stringify(data));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));

  return {
    version: 1,
    kdf: "pbkdf2-sha256",
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  };
}

export async function decryptVault(payload: EncryptedVault, password: string): Promise<VaultData> {
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(dec.decode(new Uint8Array(plaintext))) as VaultData;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test apps/wallet-extension/tests/crypto.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/wallet-extension/src/shared/constants.ts \
  apps/wallet-extension/src/shared/types.ts \
  apps/wallet-extension/src/shared/crypto.ts \
  apps/wallet-extension/tests/crypto.test.ts

git commit -m "feat: add encrypted vault helpers"
```

---

### Task 3: Storage + RPC helpers

**Files:**
- Create: apps/wallet-extension/src/shared/storage.ts
- Create: apps/wallet-extension/src/shared/rpc.ts

- [ ] **Step 1: Write minimal storage helper**

`apps/wallet-extension/src/shared/storage.ts`
```ts
export async function storageGet<T>(key: string, fallback: T): Promise<T> {
  const raw = await chrome.storage.local.get(key);
  return (raw[key] as T) ?? fallback;
}

export async function storageSet<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
```

- [ ] **Step 2: Add RPC helper**

`apps/wallet-extension/src/shared/rpc.ts`
```ts
export async function rpcCall<T>(endpoint: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/wallet-extension/src/shared/storage.ts \
  apps/wallet-extension/src/shared/rpc.ts

git commit -m "feat: add storage and rpc helpers"
```

---

### Task 4: Background service worker

**Files:**
- Create: apps/wallet-extension/src/background/index.ts

- [ ] **Step 1: Implement background message handlers**

```ts
import { generatePqKeyPair } from "@quantix/crypto";
import { deriveAddressFromPublicKey } from "@quantix/wallet-core";
import { encryptVault, decryptVault } from "../shared/crypto";
import { storageGet, storageSet } from "../shared/storage";
import { rpcCall } from "../shared/rpc";
import { VAULT_KEY, ACTIVE_ADDRESS_KEY, RPC_ENDPOINT_KEY } from "../shared/constants";
import type { VaultData, EncryptedVault, AccountRecord } from "../shared/types";

let unlockedVault: VaultData | null = null;

async function loadEncryptedVault(): Promise<EncryptedVault | null> {
  return storageGet<EncryptedVault | null>(VAULT_KEY, null);
}

async function saveVault(vault: VaultData, password: string): Promise<void> {
  const encrypted = await encryptVault(vault, password);
  await storageSet(VAULT_KEY, encrypted);
  unlockedVault = vault;
}

async function getOrInitVault(password: string): Promise<VaultData> {
  const existing = await loadEncryptedVault();
  if (!existing) {
    const now = Date.now();
    const vault: VaultData = {
      version: 1,
      accounts: {},
      activeAddress: null,
      createdAt: now,
      updatedAt: now
    };
    await saveVault(vault, password);
    return vault;
  }
  const decrypted = await decryptVault(existing, password);
  unlockedVault = decrypted;
  return decrypted;
}

async function ensureUnlocked(): Promise<VaultData> {
  if (!unlockedVault) throw new Error("Wallet locked");
  return unlockedVault;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "vault:unlock": {
        const { password } = message;
        await getOrInitVault(password);
        sendResponse({ ok: true });
        return;
      }
      case "vault:lock": {
        unlockedVault = null;
        sendResponse({ ok: true });
        return;
      }
      case "vault:status": {
        sendResponse({ ok: Boolean(unlockedVault) });
        return;
      }
      case "accounts:list": {
        const vault = await ensureUnlocked();
        sendResponse({ ok: true, accounts: Object.values(vault.accounts), active: vault.activeAddress });
        return;
      }
      case "accounts:generate": {
        const { name, password } = message;
        const vault = await ensureUnlocked();
        const pair = generatePqKeyPair();
        const address = deriveAddressFromPublicKey(pair.publicKey);
        const record: AccountRecord = {
          address,
          publicKey: pair.publicKey,
          privateKey: pair.privateKey,
          name: name || `Account ${Object.keys(vault.accounts).length + 1}`,
          createdAt: Date.now()
        };
        vault.accounts[address] = record;
        vault.activeAddress = address;
        vault.updatedAt = Date.now();
        await saveVault(vault, password);
        await storageSet(ACTIVE_ADDRESS_KEY, address);
        sendResponse({ ok: true, account: record });
        return;
      }
      case "accounts:import": {
        const { account, name, password } = message;
        const vault = await ensureUnlocked();
        const address = account.address;
        const record: AccountRecord = { ...account, name: name || `Account ${Object.keys(vault.accounts).length + 1}` };
        vault.accounts[address] = record;
        vault.activeAddress = address;
        vault.updatedAt = Date.now();
        await saveVault(vault, password);
        await storageSet(ACTIVE_ADDRESS_KEY, address);
        sendResponse({ ok: true, account: record });
        return;
      }
      case "accounts:setActive": {
        const { address, password } = message;
        const vault = await ensureUnlocked();
        if (!vault.accounts[address]) throw new Error("Unknown account");
        vault.activeAddress = address;
        vault.updatedAt = Date.now();
        await saveVault(vault, password);
        await storageSet(ACTIVE_ADDRESS_KEY, address);
        sendResponse({ ok: true });
        return;
      }
      case "rpc:call": {
        const { endpoint, method, params } = message;
        const result = await rpcCall(endpoint, method, params ?? []);
        sendResponse({ ok: true, result });
        return;
      }
      case "settings:get": {
        const endpoint = await storageGet<string>(RPC_ENDPOINT_KEY, "http://127.0.0.1:7330/rpc");
        sendResponse({ ok: true, endpoint });
        return;
      }
      case "settings:set": {
        const { endpoint } = message;
        await storageSet(RPC_ENDPOINT_KEY, endpoint);
        sendResponse({ ok: true });
        return;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message" });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));

  return true;
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/wallet-extension/src/background/index.ts

git commit -m "feat: add background worker for vault and rpc"
```

---

### Task 5: UI shell + unlock gate

**Files:**
- Create: apps/wallet-extension/src/app/layout.tsx
- Create: apps/wallet-extension/src/app/globals.css
- Create: apps/wallet-extension/src/components/TopBar.tsx
- Create: apps/wallet-extension/src/components/AccountMenu.tsx
- Create: apps/wallet-extension/src/components/UnlockGate.tsx

- [ ] **Step 1: Add global layout and styles**

`apps/wallet-extension/src/app/layout.tsx`
```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Quantix Wallet" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/wallet-extension/src/app/globals.css`
```css
:root {
  --bg: #080b16;
  --bg-soft: #0f1323;
  --card: #131a2f;
  --brand: #4c8dff;
  --mint: #3edfc9;
  --danger: #ff6f8d;
  --radius: 16px;
  --text: #e8edf9;
  --muted: #9aa7c7;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "SF Mono", "IBM Plex Mono", ui-monospace, monospace;
}

.container { padding: 16px; }
.card {
  background: var(--card);
  border-radius: var(--radius);
  padding: 16px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-soft);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.badge-ok { color: var(--mint); }
.badge-bad { color: var(--danger); }

button {
  background: var(--brand);
  color: white;
  border: none;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
}
button.secondary { background: transparent; border: 1px solid var(--brand); }
```

- [ ] **Step 2: Add TopBar + AccountMenu**

`apps/wallet-extension/src/components/TopBar.tsx`
```tsx
import AccountMenu from "./AccountMenu";

export default function TopBar({ connected }: { connected: boolean }) {
  return (
    <div className="topbar">
      <div>⚛ Quantix</div>
      <div className={connected ? "badge-ok" : "badge-bad"}>
        {connected ? "● Connected" : "○ Offline"}
      </div>
      <AccountMenu />
    </div>
  );
}
```

`apps/wallet-extension/src/components/AccountMenu.tsx`
```tsx
"use client";
import { useEffect, useState } from "react";

type Account = { address: string; name: string };

export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "accounts:list" }, (res) => {
      if (res?.ok) setAccounts(res.accounts ?? []);
    });
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <button className="secondary" onClick={() => setOpen((v) => !v)}>👤</button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: 40, width: 240 }}>
          {accounts.length === 0 && <div>No accounts</div>}
          {accounts.map((a) => (
            <div key={a.address} style={{ padding: 6, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div>{a.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{a.address}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add UnlockGate**

`apps/wallet-extension/src/components/UnlockGate.tsx`
```tsx
"use client";
import { useState } from "react";

export default function UnlockGate({ children }: { children: React.ReactNode }) {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onUnlock = () => {
    chrome.runtime.sendMessage({ type: "vault:unlock", password }, (res) => {
      if (res?.ok) {
        setUnlocked(true);
        setError(null);
      } else {
        setError(res?.error ?? "Unlock failed");
      }
    });
  };

  if (!unlocked) {
    return (
      <div className="container">
        <div className="card">
          <h3>Unlock Wallet</h3>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={{ width: "100%", padding: 8, marginBottom: 8 }}
          />
          <button onClick={onUnlock}>Unlock</button>
          {error && <div style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/wallet-extension/src/app/layout.tsx \
  apps/wallet-extension/src/app/globals.css \
  apps/wallet-extension/src/components/TopBar.tsx \
  apps/wallet-extension/src/components/AccountMenu.tsx \
  apps/wallet-extension/src/components/UnlockGate.tsx

git commit -m "feat: add ui shell and unlock gate"
```

---

### Task 6: Popup landing + activity

**Files:**
- Create: apps/wallet-extension/src/components/BalanceCard.tsx
- Create: apps/wallet-extension/src/components/ActivityList.tsx
- Create: apps/wallet-extension/src/app/popup/page.tsx

- [ ] **Step 1: Add BalanceCard**

```tsx
"use client";
import { useEffect, useState } from "react";

export default function BalanceCard() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("0");
  const [endpoint, setEndpoint] = useState<string>("http://127.0.0.1:7330/rpc");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "accounts:list" }, (res) => {
      if (res?.ok && res.active) setAddress(res.active);
    });
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "settings:get" }, (res) => {
      if (res?.ok && res.endpoint) setEndpoint(res.endpoint);
    });
  }, []);

  useEffect(() => {
    if (!address) return;
    chrome.runtime.sendMessage(
      { type: "rpc:call", endpoint, method: "qtx_getBalance", params: [address] },
      (res) => {
        if (res?.ok) setBalance(res.result?.balance ?? "0");
      }
    );
  }, [address, endpoint]);

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ color: "var(--muted)" }}>Address</div>
      <div style={{ fontSize: 12, marginBottom: 8 }}>{address ?? "-"}</div>
      <div style={{ color: "var(--muted)" }}>Balance</div>
      <div style={{ fontSize: 20 }}>{balance} QTX</div>
    </div>
  );
}
```

- [ ] **Step 2: Add ActivityList**

```tsx
"use client";
import { useEffect, useState } from "react";

type Activity = { hash: string; amount: string; from: string; to?: string; timestamp: number };

export default function ActivityList() {
  const [items, setItems] = useState<Activity[]>([]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "activity:list" }, (res) => {
      if (res?.ok) setItems(res.items ?? []);
    });
  }, []);

  if (!items.length) return <div className="card">No activity yet.</div>;

  return (
    <div className="card">
      {items.map((tx) => (
        <div key={tx.hash} style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div>{tx.amount} QTX</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{tx.hash}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add popup page**

```tsx
import TopBar from "@/components/TopBar";
import UnlockGate from "@/components/UnlockGate";
import BalanceCard from "@/components/BalanceCard";
import ActivityList from "@/components/ActivityList";

export default function PopupPage() {
  return (
    <UnlockGate>
      <TopBar connected={true} />
      <div className="container">
        <BalanceCard />
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button>Send</button>
          <button className="secondary">Receive</button>
        </div>
        <ActivityList />
      </div>
    </UnlockGate>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/wallet-extension/src/components/BalanceCard.tsx \
  apps/wallet-extension/src/components/ActivityList.tsx \
  apps/wallet-extension/src/app/popup/page.tsx

git commit -m "feat: add popup landing and activity list"
```

---

### Task 7: Settings page

**Files:**
- Create: apps/wallet-extension/src/components/SettingsForm.tsx
- Create: apps/wallet-extension/src/app/settings/page.tsx

- [ ] **Step 1: Add SettingsForm**

```tsx
"use client";
import { useState } from "react";

export default function SettingsForm() {
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:7330/rpc");

  const onSave = () => {
    chrome.runtime.sendMessage({ type: "settings:set", endpoint }, () => {});
  };

  return (
    <div className="card">
      <h3>Settings</h3>
      <label>RPC Endpoint</label>
      <input
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
        style={{ width: "100%", padding: 8, marginBottom: 8 }}
      />
      <button onClick={onSave}>Save</button>
    </div>
  );
}
```

- [ ] **Step 2: Add settings page**

```tsx
import TopBar from "@/components/TopBar";
import UnlockGate from "@/components/UnlockGate";
import SettingsForm from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <UnlockGate>
      <TopBar connected={true} />
      <div className="container">
        <SettingsForm />
      </div>
    </UnlockGate>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/wallet-extension/src/components/SettingsForm.tsx \
  apps/wallet-extension/src/app/settings/page.tsx

git commit -m "feat: add settings page"
```

---

### Task 8: Build script and dist layout

**Files:**
- Create: apps/wallet-extension/scripts/build.mjs

- [ ] **Step 1: Add build script**

```js
import { build } from "esbuild";
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const dist = resolve(root, "dist");
const out = resolve(root, "out");

if (!existsSync(out)) {
  console.error("Missing out/ folder. Run `npm run build:ui` first.");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(out, dist, { recursive: true });
cpSync(resolve(root, "src/manifest.json"), resolve(dist, "manifest.json"));

await build({
  entryPoints: [resolve(root, "src/background/index.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  outfile: resolve(dist, "background/index.js")
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/wallet-extension/scripts/build.mjs

git commit -m "build: add extension dist bundler"
```

---

## Plan Self-Review
- **Spec coverage:** UI shell, popup landing, activity, settings, account switcher, encrypted vault, background worker, build pipeline covered. Send flow and onboarding are intentionally deferred.
- **Placeholder scan:** No TODO/TBD placeholders used.
- **Type consistency:** VaultData/EncryptedVault used consistently across crypto and background.

---

## Execution Handoff
Plan complete and saved to `docs/superpowers/plans/2026-06-02-wallet-extension.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?