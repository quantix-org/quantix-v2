"use client";
import { useState, useRef } from "react";
import {
  generateKeyPair,
  walletToJson,
  parseWalletFile,
  walletFileToKeyPair,
  type WalletFile,
} from "@/lib/crypto";
import { useWallet } from "@/context/WalletContext";

type Stage = "menu" | "generated";

export default function SetupPanel() {
  const { loadWallet } = useWallet();
  const [stage, setStage] = useState<Stage>("menu");
  const [generated, setGenerated] = useState<WalletFile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleGenerate() {
    const kp = generateKeyPair();
    const wf = walletToJson(kp);
    setGenerated(wf);
    setStage("generated");
  }

  function handleDownload() {
    if (!generated) return;
    const json = JSON.stringify(generated, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${generated.address}.key.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleUseGenerated() {
    if (!generated) return;
    loadWallet(generated);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const wf = parseWalletFile(json);
        // validate key pair is intact
        walletFileToKeyPair(wf);
        loadWallet(wf);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Invalid wallet file");
      }
    };
    reader.readAsText(file);
  }

  function handleImportJson() {
    setImportError(null);
    const raw = prompt("Paste wallet JSON:");
    if (!raw) return;
    try {
      const json = JSON.parse(raw);
      const wf = parseWalletFile(json);
      walletFileToKeyPair(wf);
      loadWallet(wf);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Invalid wallet JSON");
    }
  }

  if (stage === "generated" && generated) {
    return (
      <div className="setup-panel">
        <div className="setup-hero">
          <div className="hero-icon">🎉</div>
          <h1>Wallet Created</h1>
          <p className="hero-sub">Your ML-DSA-87 post-quantum wallet is ready.</p>
        </div>
        <div className="card generated-card">
          <h3>Your address</h3>
          <div className="address-block">
            <label>Address</label>
            <div className="address-value">{generated.address}</div>
          </div>
          <div className="warning-box">
            ⚠️ Download and save your key file now. Your private key is only stored in this session — it will be lost when you close the tab.
          </div>
          <div className="generated-actions">
            <button className="btn btn-primary" onClick={handleDownload}>⬇ Download key file</button>
            <button className="btn btn-secondary" onClick={handleUseGenerated}>Open wallet →</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setStage("menu")}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-panel">
      <div className="setup-hero">
        <div className="hero-icon">🔐</div>
        <h1>Quantix Wallet</h1>
        <p className="hero-sub">Post-quantum ML-DSA-87 · Devnet</p>
      </div>

      <div className="setup-cards">
        <div className="card setup-card">
          <h3>New wallet</h3>
          <p>Generate a fresh ML-DSA-87 key pair. Download the key file and store it safely.</p>
          <button className="btn btn-primary" onClick={handleGenerate}>Generate wallet</button>
        </div>

        <div className="card setup-card">
          <h3>Import wallet</h3>
          <p>Load an existing <code>.key.json</code> file or paste JSON directly.</p>
          <div className="import-actions">
            <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
              📂 Open file
            </button>
            <button className="btn btn-ghost" onClick={handleImportJson}>Paste JSON</button>
          </div>
          {importError && <div className="error-text">{importError}</div>}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
        </div>
      </div>
    </div>
  );
}
