/**
 * SetupPanel — shown when no wallet is loaded.
 * Lets the user generate a new keypair or import a saved wallet file.
 */

import { useCallback, useRef, useState } from "react";
import {
  generateKeyPair,
  walletToJson,
  parseWalletFile,
} from "../lib/crypto";
import type { WalletFile } from "../lib/crypto";
import { useWallet } from "../context/WalletContext";

export function SetupPanel() {
  const { setWallet } = useWallet();
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<WalletFile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setImportError(null);
    try {
      // ML-DSA-87 keygen is CPU-heavy (~300 ms) — use a microtask to let the
      // browser render the spinner before blocking.
      await new Promise((r) => setTimeout(r, 20));
      const kp = generateKeyPair();
      const wf = walletToJson(kp);
      setGenerated(wf);
    } finally {
      setGenerating(false);
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!generated) return;
    const blob = new Blob([JSON.stringify(generated, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qtx-wallet-${generated.address.slice(0, 14)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generated]);

  const handleUseGenerated = useCallback(() => {
    if (generated) setWallet(generated);
  }, [generated, setWallet]);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          const wf = parseWalletFile(parsed);
          setWallet(wf);
        } catch (err) {
          setImportError(
            err instanceof Error ? err.message : "Failed to parse wallet file"
          );
        }
      };
      reader.readAsText(file);
    },
    [setWallet]
  );

  const handlePasteImport = useCallback(async () => {
    setImportError(null);
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      const wf = parseWalletFile(parsed);
      setWallet(wf);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Failed to parse clipboard content"
      );
    }
  }, [setWallet]);

  return (
    <div className="setup-panel">
      <div className="setup-hero">
        <div className="hero-icon">⬡</div>
        <h1>Quantix Wallet</h1>
        <p className="hero-sub">
          Post-quantum ML-DSA-87 · Devnet
        </p>
      </div>

      {!generated ? (
        <div className="setup-cards">
          {/* Generate new wallet */}
          <div className="card setup-card">
            <h3>New Wallet</h3>
            <p>Generate a fresh ML-DSA-87 keypair secured by quantum-resistant cryptography.</p>
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <span className="spinner-row">
                  <span className="spinner" /> Generating…
                </span>
              ) : (
                "Generate Wallet"
              )}
            </button>
            {generating && (
              <p className="hint">This takes ~300 ms — ML-DSA-87 is thorough.</p>
            )}
          </div>

          {/* Import existing */}
          <div className="card setup-card">
            <h3>Import Wallet</h3>
            <p>Load a saved <code>quantix-key/v1</code> JSON file.</p>
            <div className="import-actions">
              <button
                className="btn btn-secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                Open File…
              </button>
              <button className="btn btn-secondary" onClick={handlePasteImport}>
                Paste JSON
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={handleImportFile}
            />
            {importError && (
              <p className="error-text">{importError}</p>
            )}
          </div>
        </div>
      ) : (
        /* Key generated — show address and prompt to save */
        <div className="card generated-card">
          <h3>Wallet Generated</h3>
          <div className="address-block">
            <label>Address</label>
            <code className="address-value">{generated.address}</code>
          </div>
          <div className="warning-box">
            ⚠️ Download your wallet file now. The private key is <strong>never</strong> stored in the browser.
          </div>
          <div className="generated-actions">
            <button className="btn btn-secondary" onClick={handleDownload}>
              ⬇ Download Wallet File
            </button>
            <button className="btn btn-primary" onClick={handleUseGenerated}>
              Open Wallet →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
