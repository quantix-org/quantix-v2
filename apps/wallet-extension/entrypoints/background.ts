import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import {
  asWalletAccount,
  DEFAULT_CHAIN_ID,
  DEFAULT_RPC_ENDPOINT,
  deriveAddressFromPublicKey,
  formatQtx,
  parseQtxToBaseUnits,
  serializeSignedTx,
  transactionSigningPayload,
  type SignedTx,
} from "@quantix/wallet-core";
import { decryptVault, encryptVault } from "../utils/crypto";
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCK_TIMEOUT_MIN,
  DEFAULT_NETWORK,
  ACTIVITY_LOG_KEY,
  ACTIVE_ADDRESS_KEY,
  CURRENCY_KEY,
  LOCK_TIMEOUT_KEY,
  NETWORK_KEY,
  RPC_ENDPOINT_KEY,
  SESSION_PASSWORD_KEY,
  VAULT_KEY,
} from "../utils/constants";
import { localGet, localSet, sessionGet, sessionRemove, sessionSet } from "../utils/storage";
import type { AccountRecord, ActivityItem, EncryptedVault, VaultData } from "../utils/types";
import { rpcCall } from "../utils/rpc";

export default defineBackground(() => {});

let unlockedVault: VaultData | null = null;
let sessionPassword: string | null = null;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const value = hex.trim();
  if (value.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return bytes;
}

async function loadEncryptedVault(): Promise<EncryptedVault | null> {
  return localGet<EncryptedVault | null>(VAULT_KEY, null);
}

async function saveVault(vault: VaultData, password: string): Promise<void> {
  const encrypted = await encryptVault(vault, password);
  await localSet(VAULT_KEY, encrypted);
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
      updatedAt: now,
    };
    await saveVault(vault, password);
    return vault;
  }

  const decrypted = await decryptVault(existing, password);
  unlockedVault = decrypted;
  return decrypted;
}

async function ensureUnlocked(): Promise<VaultData> {
  if (unlockedVault) return unlockedVault;

  const restoredPassword = await sessionGet<string>(SESSION_PASSWORD_KEY, "");
  if (!restoredPassword) {
    throw new Error("Wallet locked");
  }

  sessionPassword = restoredPassword;
  return getOrInitVault(restoredPassword);
}

async function ensureSessionPassword(): Promise<string> {
  if (sessionPassword) return sessionPassword;

  const restored = await sessionGet<string>(SESSION_PASSWORD_KEY, "");
  if (!restored) {
    throw new Error("Wallet session expired");
  }

  sessionPassword = restored;
  if (!unlockedVault) {
    await getOrInitVault(restored);
  }
  return restored;
}

async function appendActivity(item: ActivityItem): Promise<void> {
  const current = await localGet<ActivityItem[]>(ACTIVITY_LOG_KEY, []);
  const deduped = current.filter((entry) => entry.hash !== item.hash);
  deduped.unshift(item);
  await localSet(ACTIVITY_LOG_KEY, deduped.slice(0, 200));
}

function signPayload(privateKeyHex: string, payload: string): string {
  const privateKey = fromHex(privateKeyHex);
  const message = new TextEncoder().encode(payload);
  return toHex(ml_dsa87.sign(message, privateKey));
}

async function sendTransferTx(to: string, amountInput: string): Promise<{ txHash: string }> {
  const vault = await ensureUnlocked();
  const from = vault.activeAddress;
  if (!from) throw new Error("No active account");

  const account = vault.accounts[from];
  if (!account) throw new Error("Active account not found");

  if (!to.startsWith("qtx1")) {
    throw new Error("Recipient address is invalid");
  }

  const endpoint = await localGet<string>(RPC_ENDPOINT_KEY, DEFAULT_RPC_ENDPOINT);
  const balance = await rpcCall<{ nonce: number }>(endpoint, "qtx_getBalance", [from]);
  let nextNonce = Number(balance?.nonce ?? 0) + 1;

  try {
    const mempool = await rpcCall<Array<{ from: string; nonce: number }>>(endpoint, "qtx_getMempool", []);
    const senderNonces = (mempool ?? []).filter((entry) => entry.from === from).map((entry) => Number(entry.nonce));
    if (senderNonces.length > 0) {
      nextNonce = Math.max(nextNonce, Math.max(...senderNonces) + 1);
    }
  } catch {
    // Best-effort only.
  }

  const amount = parseQtxToBaseUnits(amountInput || "0");
  if (amount <= 0n) {
    throw new Error("Amount must be greater than zero");
  }

  const txBase: SignedTx = {
    chainId: DEFAULT_CHAIN_ID,
    type: "transfer",
    from,
    to,
    nonce: nextNonce,
    timestamp: Date.now(),
    amount,
    fee: 0n,
    signerPublicKey: account.publicKey,
    signature: "",
  };

  const payload = transactionSigningPayload(txBase);
  const signature = signPayload(account.privateKey, payload);
  const signed: SignedTx = { ...txBase, signature };
  const result = await rpcCall<{ txHash: string }>(endpoint, "qtx_submitTransaction", [serializeSignedTx(signed)]);

  await appendActivity({
    hash: result.txHash,
    amount: formatQtx(amount.toString()).replace(" QTX", ""),
    from,
    to,
    timestamp: Date.now(),
    status: "pending",
  });

  return result;
}

async function handleMessage(message: any): Promise<any> {
  switch (message?.type) {
    case "vault:exists": {
      const existing = await loadEncryptedVault();
      return { ok: true, exists: Boolean(existing) };
    }
    case "vault:unlock": {
      const password = String(message.password ?? "");
      await getOrInitVault(password);
      sessionPassword = password;
      await sessionSet(SESSION_PASSWORD_KEY, password);
      return { ok: true };
    }
    case "vault:lock": {
      unlockedVault = null;
      sessionPassword = null;
      await sessionRemove(SESSION_PASSWORD_KEY);
      return { ok: true };
    }
    case "vault:status": {
      try {
        await ensureUnlocked();
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }
    case "accounts:list": {
      const vault = await ensureUnlocked();
      return {
        ok: true,
        accounts: Object.values(vault.accounts),
        active: vault.activeAddress,
      };
    }
    case "accounts:generate": {
      const vault = await ensureUnlocked();
      const password = await ensureSessionPassword();
      const { publicKey, secretKey } = ml_dsa87.keygen();
      const publicKeyHex = toHex(publicKey);
      const privateKeyHex = toHex(secretKey);
      const address = deriveAddressFromPublicKey(publicKeyHex);
      const record: AccountRecord = {
        address,
        publicKey: publicKeyHex,
        privateKey: privateKeyHex,
        name: String(message.name ?? "").trim() || `Account ${Object.keys(vault.accounts).length + 1}`,
        createdAt: Date.now(),
      };

      vault.accounts[address] = record;
      vault.activeAddress = address;
      vault.updatedAt = Date.now();
      await saveVault(vault, password);
      await localSet(ACTIVE_ADDRESS_KEY, address);
      return { ok: true, account: record };
    }
    case "accounts:import": {
      const vault = await ensureUnlocked();
      const password = await ensureSessionPassword();
      const normalized = asWalletAccount(message.account);
      const record: AccountRecord = {
        ...normalized,
        name: String(message.name ?? "").trim() || `Account ${Object.keys(vault.accounts).length + 1}`,
      };

      vault.accounts[record.address] = record;
      vault.activeAddress = record.address;
      vault.updatedAt = Date.now();
      await saveVault(vault, password);
      await localSet(ACTIVE_ADDRESS_KEY, record.address);
      return { ok: true, account: record };
    }
    case "accounts:setActive": {
      const vault = await ensureUnlocked();
      const password = await ensureSessionPassword();
      const address = String(message.address ?? "");
      if (!vault.accounts[address]) throw new Error("Unknown account");

      vault.activeAddress = address;
      vault.updatedAt = Date.now();
      await saveVault(vault, password);
      await localSet(ACTIVE_ADDRESS_KEY, address);
      return { ok: true };
    }
    case "activity:list": {
      const endpoint = await localGet<string>(RPC_ENDPOINT_KEY, DEFAULT_RPC_ENDPOINT);
      const items = await localGet<ActivityItem[]>(ACTIVITY_LOG_KEY, []);
      const hydrated = await Promise.all(
        items.map(async (item) => {
          try {
            const tx = await rpcCall<{ status?: string; blockHeight?: number }>(endpoint, "qtx_getTransaction", [item.hash]);
            return {
              ...item,
              status: tx?.status ?? item.status,
              blockHeight: tx?.blockHeight ?? null,
            };
          } catch {
            return item;
          }
        })
      );
      return { ok: true, items: hydrated };
    }
    case "tx:send": {
      const result = await sendTransferTx(String(message.to ?? ""), String(message.amount ?? "0"));
      return { ok: true, result };
    }
    case "rpc:call": {
      const result = await rpcCall(message.endpoint, message.method, message.params ?? []);
      return { ok: true, result };
    }
    case "settings:get": {
      return {
        ok: true,
        endpoint: await localGet<string>(RPC_ENDPOINT_KEY, DEFAULT_RPC_ENDPOINT),
        network: await localGet<string>(NETWORK_KEY, DEFAULT_NETWORK),
        lockTimeoutMin: await localGet<number>(LOCK_TIMEOUT_KEY, DEFAULT_LOCK_TIMEOUT_MIN),
        currency: await localGet<string>(CURRENCY_KEY, DEFAULT_CURRENCY),
      };
    }
    case "settings:set": {
      const endpoint = String(message.endpoint ?? DEFAULT_RPC_ENDPOINT);
      await localSet(RPC_ENDPOINT_KEY, endpoint);
      await localSet(NETWORK_KEY, String(message.network ?? DEFAULT_NETWORK));
      await localSet(LOCK_TIMEOUT_KEY, Number(message.lockTimeoutMin ?? DEFAULT_LOCK_TIMEOUT_MIN));
      await localSet(CURRENCY_KEY, String(message.currency ?? DEFAULT_CURRENCY));
      return { ok: true };
    }
    default:
      return { ok: false, error: "Unknown message" };
  }
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));

  return true;
});
