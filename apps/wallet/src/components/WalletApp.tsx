"use client";
import { useState } from "react";
import { WalletProvider, useWallet } from "@/context/WalletContext";
import SetupPanel from "./SetupPanel";
import DashboardPanel from "./DashboardPanel";
import SendPanel from "./SendPanel";
import StakePanel from "./StakePanel";
import ExplorerPanel from "./ExplorerPanel";
import SettingsPanel from "./SettingsPanel";

type Tab = "dashboard" | "send" | "stake" | "explorer" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "send",      label: "Send" },
  { id: "stake",     label: "Stake" },
  { id: "explorer",  label: "Explorer" },
  { id: "settings",  label: "Settings" },
];

function Shell() {
  const { wallet, connected, error } = useWallet();
  const [tab, setTab] = useState<Tab>("dashboard");

  if (!wallet) {
    return (
      <div className="shell">
        <div className="main-content">
          <SetupPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="logo">⚛ Quantix</div>
        <nav className="tab-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? "tab-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className={`conn-badge ${connected ? "conn-ok" : "conn-bad"}`}>
          {connected ? "● Connected" : "○ Offline"}
        </span>
      </header>

      {error && (
        <div className="global-error">
          <span>⚠ {error}</span>
        </div>
      )}

      <main className="main-content">
        {tab === "dashboard" && <DashboardPanel />}
        {tab === "send"      && <SendPanel />}
        {tab === "stake"     && <StakePanel />}
        {tab === "explorer"  && <ExplorerPanel />}
        {tab === "settings"  && <SettingsPanel />}
      </main>
    </div>
  );
}

export default function WalletApp() {
  return (
    <WalletProvider>
      <Shell />
    </WalletProvider>
  );
}
