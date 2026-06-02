import { formatQtx } from "@quantix/wallet-core";
import { DEFAULT_CURRENCY, DEFAULT_LOCK_TIMEOUT_MIN, DEFAULT_NETWORK, DEFAULT_RPC_ENDPOINT } from "./constants";
import { localGet, localSet } from "./storage";
import type { AccountRecord, ActivityItem } from "./types";

type Tab = "home" | "settings";

type WalletUiState = {
  booting: boolean;
  setupMode: boolean;
  setupConfirm: string;
  locked: boolean;
  unlockPassword: string;
  unlockError: string;
  tab: Tab;
  connected: boolean;
  rpcStatus: string;
  endpoint: string;
  network: string;
  lockTimeoutMin: number;
  currency: string;
  accounts: AccountRecord[];
  activeAddress: string;
  activeBalance: string;
  activity: ActivityItem[];
  accountsMenuOpen: boolean;
  showSend: boolean;
  showReceive: boolean;
  showExport: boolean;
  sendTo: string;
  sendAmount: string;
  sendPending: boolean;
  sendError: string;
  sendNotice: string;
  exportJson: string;
  exportError: string;
  exportNotice: string;
  settingsError: string;
  settingsNotice: string;
  accountName: string;
  importJson: string;
  accountWizard: "generate" | "import" | null;
};

const initialState = (): WalletUiState => ({
  booting: true,
  setupMode: false,
  setupConfirm: "",
  locked: true,
  unlockPassword: "",
  unlockError: "",
  tab: "home",
  connected: false,
  rpcStatus: "Not tested",
  endpoint: DEFAULT_RPC_ENDPOINT,
  network: DEFAULT_NETWORK,
  lockTimeoutMin: DEFAULT_LOCK_TIMEOUT_MIN,
  currency: DEFAULT_CURRENCY,
  accounts: [],
  activeAddress: "",
  activeBalance: "0",
  activity: [],
  accountsMenuOpen: false,
  showSend: false,
  showReceive: false,
  showExport: false,
  sendTo: "",
  sendAmount: "",
  sendPending: false,
  sendError: "",
  sendNotice: "",
  exportJson: "",
  exportError: "",
  exportNotice: "",
  settingsError: "",
  settingsNotice: "",
  accountName: "",
  importJson: "",
  accountWizard: null,
});

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function balanceLabel(balance: string): string {
  return formatQtx(balance) || "0 QTX";
}

export async function mountWalletApp(root: HTMLElement, initialTab: Tab): Promise<void> {
  const state = initialState();
  state.tab = initialTab;

  const sendMessage = async <T,>(message: unknown): Promise<T> => browser.runtime.sendMessage(message) as Promise<T>;
  let refreshTimer: number | undefined;

  function restoreFocus(previouslyFocused: HTMLElement | null): void {
    if (!previouslyFocused?.dataset.field) return;

    const field = previouslyFocused.dataset.field;
    const next = root.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (!next) return;

    if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
      const selectionStart = previouslyFocused instanceof HTMLInputElement || previouslyFocused instanceof HTMLTextAreaElement ? previouslyFocused.selectionStart : null;
      const selectionEnd = previouslyFocused instanceof HTMLInputElement || previouslyFocused instanceof HTMLTextAreaElement ? previouslyFocused.selectionEnd : null;
      next.focus();
      if (selectionStart !== null && selectionEnd !== null && typeof next.setSelectionRange === "function") {
        next.setSelectionRange(selectionStart, selectionEnd);
      }
      return;
    }

    if (typeof next.focus === "function") {
      next.focus();
    }
  }

  function renderUnlock(): string {
    if (state.setupMode) {
      return `
        <div class="unlock-shell">
          <div class="card unlock-card">
            <div class="brand" style="margin-bottom: 14px;">
              <img class="brand-logo" src="wallet-logo.png" alt="Quantix logo" />
              <span>Quantix Wallet</span>
            </div>
            <div class="stack">
              <div class="label" style="font-weight:600;font-size:13px;margin-bottom:4px;">Welcome! Create a wallet password</div>
              <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">This password encrypts your wallet on this device. You will need it every time you open the extension.</div>
              <div>
                <div class="label">New Password</div>
                <input data-field="unlockPassword" type="password" placeholder="Choose a strong password" value="${escapeHtml(state.unlockPassword)}" />
              </div>
              <div>
                <div class="label">Confirm Password</div>
                <input data-field="setupConfirm" type="password" placeholder="Repeat password" value="${escapeHtml(state.setupConfirm)}" />
              </div>
              <button data-action="setup-create">Create Wallet</button>
              ${state.unlockError ? `<div class="error-text">${escapeHtml(state.unlockError)}</div>` : ""}
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="unlock-shell">
        <div class="card unlock-card">
          <div class="brand" style="margin-bottom: 14px;">
            <img class="brand-logo" src="wallet-logo.png" alt="Quantix logo" />
            <span>Quantix Wallet</span>
          </div>
          <div class="stack">
            <div>
              <div class="label">Unlock Wallet</div>
              <input data-field="unlockPassword" type="password" placeholder="Session password" value="${escapeHtml(state.unlockPassword)}" />
            </div>
            <button data-action="unlock">Unlock</button>
            ${state.unlockError ? `<div class="error-text">${escapeHtml(state.unlockError)}</div>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function renderAccountsMenu(): string {
    if (!state.accountsMenuOpen) return "";
    const items = state.accounts.length
      ? state.accounts
          .map(
            (account) => `
              <button class="menu-item-btn" data-action="set-active" data-address="${escapeHtml(account.address)}" type="button">
                <div class="menu-item-title">
                  <span>${escapeHtml(account.name)}</span>
                  ${state.activeAddress === account.address ? '<span class="active-pill">Active</span>' : ""}
                </div>
                <div class="mono truncate">${escapeHtml(account.address)}</div>
              </button>
            `
          )
          .join("")
      : `<div class="empty-note" style="padding: 10px 12px;">No accounts yet.</div>`;

    return `
      <div class="menu-list">
        <button class="menu-item-btn" data-action="open-generate-account" type="button">
          <div class="menu-item-title"><span>Generate Wallet</span><span class="active-pill">New</span></div>
          <div class="mono truncate">Create a fresh account in this vault</div>
        </button>
        <button class="menu-item-btn" data-action="open-import-account" type="button">
          <div class="menu-item-title"><span>Import Wallet</span><span class="active-pill">JSON</span></div>
          <div class="mono truncate">Import a wallet file or pasted JSON</div>
        </button>
        <button class="menu-item-btn" data-action="open-export-wallet" type="button">
          <div class="menu-item-title"><span>Export Wallet</span><span class="active-pill">Backup</span></div>
          <div class="mono truncate">Export active wallet JSON</div>
        </button>
        <div style="height: 1px; background: var(--line); margin: 6px 0;"></div>
        ${items}
      </div>
    `;
  }

  function renderTopBar(): string {
    return `
      <header class="topbar">
        <div class="brand">
          <img class="brand-logo" src="wallet-logo.png" alt="Quantix logo" />
          <span>Quantix</span>
        </div>
        <div class="status-badge ${state.connected ? "badge-ok" : "badge-bad"}">${state.connected ? "● Connected" : "○ Offline"}</div>
        <div class="topbar-actions">
          <button class="ghost" aria-label="Settings" data-action="open-settings">⚙</button>
          <button class="ghost" aria-label="Accounts" data-action="toggle-accounts">👤</button>
          ${renderAccountsMenu()}
        </div>
      </header>
    `;
  }

  function renderTabs(): string {
    return `
      <div class="tabs-row">
        <button class="tab-btn ${state.tab === "home" ? "tab-active" : ""}" data-action="set-tab" data-tab="home">Home</button>
        <button class="tab-btn ${state.tab === "settings" ? "tab-active" : ""}" data-action="set-tab" data-tab="settings">Settings</button>
      </div>
    `;
  }

  function renderHome(): string {
    return `
      <div class="card section">
        <div>
          <div class="label">Address</div>
          <div class="mono truncate">${escapeHtml(state.activeAddress || "-")}</div>
        </div>
        <div>
          <div class="label">Balance</div>
          <div class="balance-value">${escapeHtml(balanceLabel(state.activeBalance))}</div>
        </div>
      </div>
      <div class="actions-row">
        <button data-action="open-send">Send</button>
        <button class="secondary" data-action="open-receive">Receive</button>
      </div>
      <div class="home-activity">
        <div class="label">Recent Activity</div>
        ${renderActivity()}
      </div>
    `;
  }

  function renderActivity(): string {
    if (!state.activity.length) {
      return `<div class="card"><div class="empty-note">No activity yet.</div></div>`;
    }

    return `
      <div class="card">
        ${state.activity
          .map(
            (item) => `
              <div class="activity-item">
                <div class="activity-amount">${escapeHtml(item.amount)} QTX</div>
                <div class="empty-note truncate">${escapeHtml(item.to ? `to ${item.to}` : "pending transfer")}</div>
                <div class="empty-note">${escapeHtml(formatTime(item.timestamp))}</div>
                <div class="empty-note">Status: ${escapeHtml(item.status ?? "pending")}</div>
                <a class="tx-link mono truncate" href="https://devnet.qpqb.org/#/tx/${encodeURIComponent(item.hash)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.hash)}</a>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderSettings(): string {
    return `
      <div class="card section">
        <div>
          <h3 class="settings-title">Settings</h3>
          <div class="field">
            <div class="label">RPC Endpoint</div>
            <input data-field="endpoint" value="${escapeHtml(state.endpoint)}" placeholder="https://rpc1.qpqb.org" />
          </div>
          <div class="field">
            <div class="label">Network</div>
            <select data-field="network">
              <option value="devnet" ${state.network === "devnet" ? "selected" : ""}>Devnet</option>
              <option value="testnet" ${state.network === "testnet" ? "selected" : ""}>Testnet</option>
              <option value="mainnet" ${state.network === "mainnet" ? "selected" : ""}>Mainnet</option>
            </select>
          </div>
          <div class="field">
            <div class="label">Auto Lock (minutes)</div>
            <input data-field="lockTimeoutMin" type="number" min="1" max="240" value="${String(state.lockTimeoutMin)}" />
          </div>
          <div class="field">
            <div class="label">Currency Display</div>
            <select data-field="currency">
              <option value="QTX" ${state.currency === "QTX" ? "selected" : ""}>QTX</option>
              <option value="USDT" ${state.currency === "USDT" ? "selected" : ""}>USDT</option>
              <option value="USD" ${state.currency === "USD" ? "selected" : ""}>USD</option>
            </select>
          </div>
          <div class="actions-row">
            <button data-action="save-settings">Save</button>
            <button class="secondary" data-action="test-rpc">Test RPC</button>
          </div>
          <div class="inline-status">RPC Status: ${escapeHtml(state.rpcStatus)}</div>
          ${state.settingsError ? `<div class="error-text">${escapeHtml(state.settingsError)}</div>` : ""}
          ${state.settingsNotice ? `<div class="save-note">${escapeHtml(state.settingsNotice)}</div>` : ""}
        </div>
      </div>
    `;
  }

  function renderAccountWizard(): string {
    if (!state.accountWizard) return "";

    if (state.accountWizard === "generate") {
      return `
        <div class="modal-backdrop" data-action="close-account-wizard">
          <div class="modal-card">
            <h3 class="settings-title">Generate Wallet</h3>
            <div class="field">
              <div class="label">Account Name (optional)</div>
              <input data-field="accountName" value="${escapeHtml(state.accountName)}" placeholder="My Trading Wallet" />
            </div>
            ${state.settingsError ? `<div class="error-text">${escapeHtml(state.settingsError)}</div>` : ""}
            ${state.settingsNotice ? `<div class="save-note">${escapeHtml(state.settingsNotice)}</div>` : ""}
            <div class="actions-row" style="margin-bottom: 0;">
              <button class="secondary" data-action="close-account-wizard">Cancel</button>
              <button data-action="generate-account">Generate</button>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="modal-backdrop" data-action="close-account-wizard">
        <div class="modal-card">
          <h3 class="settings-title">Import Wallet</h3>
          <div class="field">
            <div class="label">Account Name (optional)</div>
            <input data-field="accountName" value="${escapeHtml(state.accountName)}" placeholder="Imported Wallet" />
          </div>
          <div class="field">
            <div class="label">Wallet JSON</div>
            <textarea data-field="importJson" rows="6" placeholder='{"version":"quantix-key/v1","address":"qtx1...","publicKey":"...","privateKey":"..."}'>${escapeHtml(state.importJson)}</textarea>
          </div>
          ${state.settingsError ? `<div class="error-text">${escapeHtml(state.settingsError)}</div>` : ""}
          ${state.settingsNotice ? `<div class="save-note">${escapeHtml(state.settingsNotice)}</div>` : ""}
          <div class="actions-row" style="margin-bottom: 0;">
            <button class="secondary" data-action="close-account-wizard">Cancel</button>
            <button data-action="import-account">Import</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderSendModal(): string {
    if (!state.showSend) return "";
    return `
      <div class="modal-backdrop" data-action="close-send">
        <div class="modal-card">
          <h3 class="settings-title">Send QTX</h3>
          <div class="field">
            <div class="label">To Address</div>
            <input data-field="sendTo" value="${escapeHtml(state.sendTo)}" placeholder="qtx1..." />
          </div>
          <div class="field">
            <div class="label">Amount</div>
            <input data-field="sendAmount" value="${escapeHtml(state.sendAmount)}" placeholder="0.00" />
          </div>
          ${state.sendError ? `<div class="error-text">${escapeHtml(state.sendError)}</div>` : ""}
          ${state.sendNotice ? `<div class="save-note">${escapeHtml(state.sendNotice)}</div>` : ""}
          <div class="actions-row" style="margin-bottom: 0;">
            <button class="secondary" data-action="close-send">Cancel</button>
            <button data-action="send-submit" ${state.sendPending ? "disabled" : ""}>${state.sendPending ? "Sending..." : "Continue"}</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderReceiveModal(): string {
    if (!state.showReceive) return "";
    return `
      <div class="modal-backdrop" data-action="close-receive">
        <div class="modal-card">
          <h3 class="settings-title">Receive QTX</h3>
          <div class="field">
            <div class="label">Your Address</div>
            <input value="${escapeHtml(state.activeAddress || "No active account")}" readonly />
          </div>
          <div class="actions-row" style="margin-bottom: 0;">
            <button class="secondary" data-action="close-receive">Close</button>
            <button data-action="copy-address">Copy Address</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderExportModal(): string {
    if (!state.showExport) return "";

    return `
      <div class="modal-backdrop" data-action="close-export">
        <div class="modal-card">
          <h3 class="settings-title">Export Wallet</h3>
          <div class="field">
            <div class="label">Active Address</div>
            <input value="${escapeHtml(state.activeAddress || "No active account")}" readonly />
          </div>
          <div class="field">
            <div class="label">Wallet JSON</div>
            <textarea class="export-json" rows="7" readonly>${escapeHtml(state.exportJson || "Click Export JSON to generate backup")}</textarea>
          </div>
          ${state.exportError ? `<div class="error-text">${escapeHtml(state.exportError)}</div>` : ""}
          ${state.exportNotice ? `<div class="save-note">${escapeHtml(state.exportNotice)}</div>` : ""}
          <div class="actions-row actions-row-3" style="margin-bottom: 0;">
            <button class="secondary" data-action="close-export">Close</button>
            <button class="secondary" data-action="copy-export-json">Copy JSON</button>
            <button data-action="download-export-json">Download JSON</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderApp(): string {
    return `
      <div class="app-shell">
        ${renderTopBar()}
        <main class="container scroll-area">
          ${renderTabs()}
          ${state.tab === "home" ? renderHome() : renderSettings()}
        </main>
        ${renderSendModal()}
        ${renderReceiveModal()}
        ${renderExportModal()}
        ${renderAccountWizard()}
      </div>
    `;
  }

  function render(preserveFocus = false): void {
    const previouslyFocused = preserveFocus ? (document.activeElement as HTMLElement | null) : null;
    root.innerHTML = state.locked ? renderUnlock() : renderApp();
    if (preserveFocus) {
      restoreFocus(previouslyFocused);
    }
  }

  async function loadSettings(): Promise<void> {
    const response = await sendMessage<any>({ type: "settings:get" });
    if (response?.ok) {
      state.endpoint = response.endpoint ?? DEFAULT_RPC_ENDPOINT;
      state.network = response.network ?? DEFAULT_NETWORK;
      state.lockTimeoutMin = Number(response.lockTimeoutMin ?? DEFAULT_LOCK_TIMEOUT_MIN);
      state.currency = response.currency ?? DEFAULT_CURRENCY;
    }
  }

  async function refreshConnection(): Promise<void> {
    try {
      const response = await sendMessage<any>({
        type: "rpc:call",
        endpoint: state.endpoint,
        method: "qtx_getChainInfo",
        params: [],
      });
      state.connected = Boolean(response?.ok ?? true);
      state.rpcStatus = `Connected (${response?.result?.chainId ?? "unknown"} @ height ${response?.result?.height ?? 0})`;
    } catch (error) {
      state.connected = false;
      state.rpcStatus = error instanceof Error ? error.message : "Disconnected";
    }
  }

  async function refreshAccounts(): Promise<void> {
    try {
      const response = await sendMessage<any>({ type: "accounts:list" });
      if (response?.ok) {
        state.accounts = response.accounts ?? [];
        state.activeAddress = response.active ?? "";
      }
    } catch {
      // Locked state handles this.
    }
  }

  async function refreshActivity(): Promise<void> {
    try {
      const response = await sendMessage<any>({ type: "activity:list" });
      if (response?.ok) {
        state.activity = response.items ?? [];
      }
    } catch {
      state.activity = [];
    }
  }

  async function refreshBalance(): Promise<void> {
    if (!state.activeAddress) {
      state.activeBalance = "0";
      return;
    }

    try {
      const response = await sendMessage<any>({
        type: "rpc:call",
        endpoint: state.endpoint,
        method: "qtx_getBalance",
        params: [state.activeAddress],
      });
      state.activeBalance = String(response?.result?.balance ?? "0");
    } catch {
      state.activeBalance = "0";
    }
  }

  async function refreshUnlockedData(): Promise<void> {
    await Promise.all([loadSettings(), refreshConnection(), refreshAccounts(), refreshActivity()]);
    await refreshBalance();
  }

  async function ensureVaultSessionAlive(): Promise<boolean> {
    const status = await sendMessage<any>({ type: "vault:status" }).catch(() => ({ ok: false }));
    if (status?.ok) return true;

    state.locked = true;
    state.accountWizard = null;
    state.unlockError = "Wallet session expired";
    state.accountsMenuOpen = false;
    state.showSend = false;
    state.showReceive = false;
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    render();
    return false;
  }

  async function unlockWallet(): Promise<void> {
    state.unlockError = "";
    try {
      const response = await sendMessage<any>({ type: "vault:unlock", password: state.unlockPassword });
      if (!response?.ok) {
        state.unlockError = response?.error ?? "Unlock failed";
        render();
        return;
      }

      state.locked = false;
      state.unlockPassword = "";
      await refreshUnlockedData();
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }
      refreshTimer = window.setInterval(() => {
        void (async () => {
          if (!(await ensureVaultSessionAlive())) {
            return;
          }
          await refreshConnection();
          await refreshAccounts();
          await refreshActivity();
          await refreshBalance();
          const focused = document.activeElement;
          const userIsTyping =
            focused instanceof HTMLInputElement ||
            focused instanceof HTMLTextAreaElement;
          if (!userIsTyping) {
            render(true);
          }
        })();
      }, 2000);
    } catch (error) {
      state.unlockError = error instanceof Error ? error.message : "Unlock failed";
    }

    render();
  }

  async function saveSettings(): Promise<void> {
    state.settingsError = "";
    state.settingsNotice = "";
    try {
      const response = await sendMessage<any>({
        type: "settings:set",
        endpoint: state.endpoint,
        network: state.network,
        lockTimeoutMin: state.lockTimeoutMin,
        currency: state.currency,
      });

      if (!response?.ok) {
        state.settingsError = response?.error ?? "Failed to save settings";
        render();
        return;
      }

      state.settingsNotice = "Saved";
      await refreshConnection();
    } catch (error) {
      state.settingsError = error instanceof Error ? error.message : "Failed to save settings";
    }
    render();
  }

  async function testRpc(): Promise<void> {
    state.settingsError = "";
    try {
      const response = await sendMessage<any>({
        type: "rpc:call",
        endpoint: state.endpoint,
        method: "qtx_getChainInfo",
        params: [],
      });

      if (!response?.ok) {
        state.rpcStatus = "Disconnected";
        state.settingsError = response?.error ?? "RPC call failed";
      } else {
        state.connected = true;
        state.rpcStatus = `Connected (${response.result?.chainId ?? "unknown"} @ height ${response.result?.height ?? 0})`;
      }
    } catch (error) {
      state.connected = false;
      state.rpcStatus = "Disconnected";
      state.settingsError = error instanceof Error ? error.message : "RPC unreachable";
    }
    render();
  }

  async function generateAccount(): Promise<void> {
    if (!(await ensureVaultSessionAlive())) return;
    state.settingsError = "";
    state.settingsNotice = "";
    try {
      const response = await sendMessage<any>({ type: "accounts:generate", name: state.accountName.trim() || undefined });
      if (!response?.ok) {
        state.settingsError = response?.error ?? "Failed to generate account";
        render();
        return;
      }

      state.settingsNotice = `Generated ${response.account?.address ?? "account"}`;
      state.accountName = "";
      state.accountWizard = null;
      state.accountsMenuOpen = false;
      await refreshAccounts();
      await refreshBalance();
    } catch (error) {
      state.settingsError = error instanceof Error ? error.message : "Failed to generate account";
    }
    render();
  }

  async function importAccount(): Promise<void> {
    if (!(await ensureVaultSessionAlive())) return;
    state.settingsError = "";
    state.settingsNotice = "";

    try {
      const parsed = JSON.parse(state.importJson);
      const response = await sendMessage<any>({ type: "accounts:import", account: parsed, name: state.accountName.trim() || undefined });
      if (!response?.ok) {
        state.settingsError = response?.error ?? "Failed to import account";
        render();
        return;
      }

      state.settingsNotice = `Imported ${response.account?.address ?? "account"}`;
      state.importJson = "";
      state.accountName = "";
      state.accountWizard = null;
      state.accountsMenuOpen = false;
      await refreshAccounts();
      await refreshBalance();
    } catch (error) {
      state.settingsError = error instanceof Error ? error.message : "Invalid JSON for import";
    }
    render();
  }

  async function setActive(address: string): Promise<void> {
    if (!(await ensureVaultSessionAlive())) return;
    const response = await sendMessage<any>({ type: "accounts:setActive", address });
    if (response?.ok) {
      state.activeAddress = address;
      state.accountsMenuOpen = false;
      await refreshBalance();
    }
    render();
  }

  async function sendTransaction(): Promise<void> {
    if (!(await ensureVaultSessionAlive())) return;
    state.sendError = "";
    state.sendNotice = "";
    state.sendPending = true;
    render();

    try {
      const response = await sendMessage<any>({ type: "tx:send", to: state.sendTo.trim(), amount: state.sendAmount.trim() });
      if (!response?.ok) {
        state.sendError = response?.error ?? "Failed to send transaction";
        state.sendPending = false;
        render();
        return;
      }

      state.sendNotice = `Submitted: ${response.result?.txHash ?? "ok"}`;
      state.sendAmount = "";
      await refreshActivity();
      await refreshBalance();
    } catch (error) {
      state.sendError = error instanceof Error ? error.message : "Failed to send transaction";
    }

    state.sendPending = false;
    render();
  }

  async function copyAddress(): Promise<void> {
    if (!state.activeAddress) return;
    await navigator.clipboard.writeText(state.activeAddress).catch(() => undefined);
    state.sendNotice = "Address copied";
    render();
  }

  async function openExportWallet(): Promise<void> {
    if (!(await ensureVaultSessionAlive())) return;

    state.exportError = "";
    state.exportNotice = "";
    state.exportJson = "";

    if (!state.activeAddress) {
      state.exportError = "No active account to export";
      state.showExport = true;
      render(true);
      return;
    }

    try {
      const response = await sendMessage<any>({ type: "accounts:export", address: state.activeAddress });
      if (!response?.ok) {
        state.exportError = response?.error ?? "Failed to export wallet";
      } else {
        state.exportJson = JSON.stringify(response.account, null, 2);
        state.exportNotice = "Wallet JSON ready. Keep this file private.";
      }
    } catch (error) {
      state.exportError = error instanceof Error ? error.message : "Failed to export wallet";
    }

    state.showExport = true;
    state.accountsMenuOpen = false;
    render(true);
  }

  async function copyExportJson(): Promise<void> {
    if (!state.exportJson) {
      state.exportError = "No JSON to copy";
      render(true);
      return;
    }

    try {
      await navigator.clipboard.writeText(state.exportJson);
      state.exportError = "";
      state.exportNotice = "Wallet JSON copied";
    } catch {
      state.exportError = "Failed to copy JSON";
    }
    render(true);
  }

  function downloadExportJson(): void {
    if (!state.exportJson) {
      state.exportError = "No JSON to download";
      render(true);
      return;
    }

    try {
      const addressPart = state.activeAddress || "wallet";
      const blob = new Blob([state.exportJson], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `quantix-wallet-${addressPart}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      state.exportError = "";
      state.exportNotice = "Wallet JSON downloaded";
    } catch {
      state.exportError = "Failed to download JSON";
    }

    render(true);
  }

  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target) return;

    const action = target.dataset.action;
    if (!action) return;

    if (action === "close-send" && event.target === target) {
      state.showSend = false;
      render(true);
      return;
    }

    if (action === "close-receive" && event.target === target) {
      state.showReceive = false;
      render(true);
      return;
    }

    if (action === "close-export" && event.target === target) {
      state.showExport = false;
      state.exportError = "";
      state.exportNotice = "";
      render(true);
      return;
    }

    if (action === "close-account-wizard" && event.target === target) {
      state.accountWizard = null;
      state.accountName = "";
      state.importJson = "";
      state.settingsError = "";
      state.settingsNotice = "";
      render(true);
      return;
    }

    // For backdrop-close actions: if the click landed inside the modal content
    // (event.target !== backdrop element) we must swallow the event entirely so
    // the switch below does not close the modal.
    if (action === "close-send" || action === "close-receive" || action === "close-account-wizard" || action === "close-export") {
      return;
    }

    void (async () => {
      switch (action) {
        case "setup-create": {
          state.unlockError = "";
          if (!state.unlockPassword) {
            state.unlockError = "Password cannot be empty";
            render();
            return;
          }
          if (state.unlockPassword !== state.setupConfirm) {
            state.unlockError = "Passwords do not match";
            render();
            return;
          }
          if (state.unlockPassword.length < 6) {
            state.unlockError = "Password must be at least 6 characters";
            render();
            return;
          }
          const setupRes = await sendMessage<any>({ type: "vault:unlock", password: state.unlockPassword });
          if (!setupRes?.ok) {
            state.unlockError = setupRes?.error ?? "Failed to create wallet";
            render();
            return;
          }
          state.setupMode = false;
          state.setupConfirm = "";
          state.locked = false;
          state.unlockPassword = "";
          await refreshUnlockedData();
          if (refreshTimer) window.clearInterval(refreshTimer);
          refreshTimer = window.setInterval(() => {
            void (async () => {
              if (!(await ensureVaultSessionAlive())) return;
              await refreshConnection();
              await refreshAccounts();
              await refreshBalance();
              const focused = document.activeElement;
              const userIsTyping = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement;
              if (!userIsTyping) render(true);
            })();
          }, 2000);
          render();
          return;
        }
        case "unlock":
          await unlockWallet();
          return;
        case "set-tab":
          state.tab = target.dataset.tab as Tab;
          state.accountsMenuOpen = false;
          render(true);
          return;
        case "open-settings":
          state.tab = "settings";
          state.accountsMenuOpen = false;
          render(true);
          return;
        case "toggle-accounts":
          state.accountsMenuOpen = !state.accountsMenuOpen;
          render(true);
          return;
        case "open-generate-account":
          if (!(await ensureVaultSessionAlive())) return;
          state.accountWizard = "generate";
          state.accountName = "";
          state.importJson = "";
          state.accountsMenuOpen = false;
          state.settingsError = "";
          state.settingsNotice = "";
          render(true);
          return;
        case "open-import-account":
          if (!(await ensureVaultSessionAlive())) return;
          state.accountWizard = "import";
          state.accountName = "";
          state.importJson = "";
          state.accountsMenuOpen = false;
          state.settingsError = "";
          state.settingsNotice = "";
          render(true);
          return;
        case "open-export-wallet":
          await openExportWallet();
          return;
        case "close-account-wizard":
          // handled by the backdrop-only guard above; this branch only fires
          // when a button with data-action="close-account-wizard" is clicked directly
          state.accountWizard = null;
          state.accountName = "";
          state.importJson = "";
          state.settingsError = "";
          state.settingsNotice = "";
          render(true);
          return;
        case "set-active":
          await setActive(String(target.dataset.address ?? ""));
          return;
        case "open-send":
          state.showSend = true;
          render(true);
          return;
        case "open-receive":
          state.showReceive = true;
          render(true);
          return;
        case "close-send":
          state.showSend = false;
          render(true);
          return;
        case "close-receive":
          state.showReceive = false;
          render(true);
          return;
        case "close-export":
          state.showExport = false;
          state.exportError = "";
          state.exportNotice = "";
          render(true);
          return;
        case "copy-export-json":
          await copyExportJson();
          return;
        case "download-export-json":
          downloadExportJson();
          return;
        case "send-submit":
          await sendTransaction();
          return;
        case "copy-address":
          await copyAddress();
          return;
        case "save-settings":
          await saveSettings();
          return;
        case "test-rpc":
          await testRpc();
          return;
        case "generate-account":
          await generateAccount();
          return;
        case "import-account":
          await importAccount();
          return;
        default:
          return;
      }
    })();
  });

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!target?.dataset.field) return;

    switch (target.dataset.field) {
      case "unlockPassword":
        state.unlockPassword = target.value;
        break;
      case "endpoint":
        state.endpoint = target.value;
        break;
      case "network":
        state.network = target.value;
        break;
      case "lockTimeoutMin":
        state.lockTimeoutMin = Number(target.value || DEFAULT_LOCK_TIMEOUT_MIN);
        break;
      case "currency":
        state.currency = target.value;
        break;
      case "accountName":
        state.accountName = target.value;
        break;
      case "importJson":
        state.importJson = target.value;
        break;
      case "setupConfirm":
        state.setupConfirm = target.value;
        break;
      case "sendTo":
        state.sendTo = target.value;
        break;
      case "sendAmount":
        state.sendAmount = target.value;
        break;
      default:
        break;
    }
  });

  async function boot(): Promise<void> {
    const existsRes = await sendMessage<any>({ type: "vault:exists" }).catch(() => ({ ok: true, exists: true }));
    if (!existsRes?.exists) {
      state.setupMode = true;
      state.locked = true;
      state.booting = false;
      render();
      return;
    }

    const status = await sendMessage<any>({ type: "vault:status" }).catch(() => ({ ok: false }));
    state.locked = !Boolean(status?.ok);
    if (!state.locked) {
      await refreshUnlockedData();
      refreshTimer = window.setInterval(() => {
        void (async () => {
          if (!(await ensureVaultSessionAlive())) {
            return;
          }
          await refreshConnection();
          await refreshAccounts();
          await refreshActivity();
          await refreshBalance();
          const focused = document.activeElement;
          const userIsTyping =
            focused instanceof HTMLInputElement ||
            focused instanceof HTMLTextAreaElement;
          if (!userIsTyping) {
            render(true);
          }
        })();
      }, 2000);
    }
    state.booting = false;
    render();
  }

  await boot();
}