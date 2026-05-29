/**
 * Root App component — navigation shell with tab routing.
 */

import { useState } from "react";
import { WalletProvider, useWallet } from "./context/WalletContext";
import { SetupPanel } from "./components/SetupPanel";
import { DashboardPanel } from "./components/DashboardPanel";
import { SendPanel } from "./components/SendPanel";
import { StakePanel } from "./components/StakePanel";
import { ExplorerPanel } from "./components/ExplorerPanel";
import { SettingsPanel } from "./components/SettingsPanel";

type Tab = "dashboard" | "send" | "stake" | "explorer" | "settings";

function WalletShell() {
  const { wallet, connected, connecting, error, clearError } = useWallet();
  const [tab, setTab] = useState<Tab>("dashboard");

  // If no wallet loaded, show setup screen
  if (!wallet) {
    return (
      <div className="shell">
        <header className="topbar">
          <span className="logo">⬡ Quantix</span>
          <span className={`conn-badge ${connected ? "conn-ok" : "conn-bad"}`}>
            {connecting ? "connecting…" : connected ? "devnet" : "offline"}
          </span>
        </header>
        <main className="main-content">
          <SetupPanel />
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo">⬡ Quantix</span>
        <nav className="tab-nav">
          {(
            [
              ["dashboard", "Dashboard"],
              ["send", "Send"],
              ["stake", "Stake"],
              ["explorer", "Explorer"],
              ["settings", "Settings"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={`tab-btn ${tab === id ? "tab-active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className={`conn-badge ${connected ? "conn-ok" : "conn-bad"}`}>
          {connecting ? "…" : connected ? "devnet" : "offline"}
        </span>
      </header>

      {error && (
        <div className="global-error" role="alert">
          {error}
          <button className="close-btn" onClick={clearError}>✕</button>
        </div>
      )}

      <main className="main-content">
        {tab === "dashboard" && <DashboardPanel />}
        {tab === "send" && <SendPanel />}
        {tab === "stake" && <StakePanel />}
        {tab === "explorer" && <ExplorerPanel />}
        {tab === "settings" && <SettingsPanel />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <WalletShell />
    </WalletProvider>
  );
}
