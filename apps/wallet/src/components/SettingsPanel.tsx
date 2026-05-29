"use client";
import { useState, useRef } from "react";
import { useWallet } from "@/context/WalletContext";
import { parseWalletFile, walletFileToKeyPair } from "@/lib/crypto";
import { shortAddress } from "@/lib/format";

export default function SettingsPanel() {
  const { wallet, nodeUrl, setNodeUrl, clearWallet, loadWallet } = useWallet();

  const [nodeInput, setNodeInput] = useState(nodeUrl);
  const [saved, setSaved] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleSaveNode() {
    setNodeUrl(nodeInput.trim() || nodeUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setImportErr(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const wf = parseWalletFile(json);
        walletFileToKeyPair(wf); // validate keys
        loadWallet(wf);
      } catch (err) {
        setImportErr(err instanceof Error ? err.message : "Invalid wallet file");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div>
      {/* Wallet info */}
      <div className="card">
        <div className="card-head">Active Wallet</div>
        {wallet ? (
          <>
            <div className="kv-row">
              <div className="kv-key">Address</div>
              <div className="kv-val">{wallet.address}</div>
            </div>
            <div className="kv-row">
              <div className="kv-key">Short</div>
              <div className="kv-val">{shortAddress(wallet.address)}</div>
            </div>
            <div className="kv-row">
              <div className="kv-key">Created</div>
              <div className="kv-val">{wallet.createdAt ? new Date(wallet.createdAt).toLocaleString() : "—"}</div>
            </div>
            <div className="settings-actions">
              <button className="btn btn-danger" onClick={clearWallet}>🔒 Lock wallet</button>
              <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                ↩ Switch wallet
              </button>
            </div>
          </>
        ) : (
          <div className="empty">No wallet loaded</div>
        )}
      </div>

      {/* Node URL */}
      <div className="card">
        <div className="card-head">Node Connection</div>
        <div style={{ padding: "14px 16px" }}>
          <div className="field">
            <label>RPC URL</label>
            <input
              className="input"
              value={nodeInput}
              onChange={(e) => setNodeInput(e.target.value)}
              placeholder="http://localhost:7330/rpc"
            />
            <div className="hint-text">
              Devnet default: http://localhost:7330/rpc · VPS: http://164.68.118.17:7332/rpc
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleSaveNode}>
            {saved ? "✓ Saved" : "Save"}
          </button>
        </div>
      </div>

      {importErr && <div className="error-text" style={{ marginBottom: 10 }}>{importErr}</div>}

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={handleImportFile}
      />
    </div>
  );
}
