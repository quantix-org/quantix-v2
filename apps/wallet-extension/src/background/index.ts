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
