/**
 * SettingsPanel — configure RPC endpoint, view chain info, manage wallet session.
 */

import { useCallback, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { shortAddress } from "../lib/format";

export function SettingsPanel() {
  const { endpoint, chainId, connected, wallet, setEndpoint, connect, setWallet } =
    useWallet();
  const [urlInput, setUrlInput] = useState(endpoint);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleSaveEndpoint = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setEndpoint(urlInput.trim());
    try {
      await connect();
      setTestResult("✓ Connected successfully");
    } catch {
      setTestResult("✗ Connection failed — check the URL and try again");
    } finally {
      setTesting(false);
    }
  }, [urlInput, setEndpoint, connect]);

  const handleDisconnectWallet = useCallback(() => {
    setWallet(null);
  }, [setWallet]);

  return (
    <div className="form-panel">
      <h2>Settings</h2>

      {/* Wallet info */}
      {wallet && (
        <div className="card settings-section">
          <div className="section-title">Active Wallet</div>
          <div className="kv-row">
            <span className="kv-key">Address</span>
            <code className="kv-val">{shortAddress(wallet.address, 8)}</code>
          </div>
          <div className="kv-row">
            <span className="kv-key">Public Key</span>
            <code className="kv-val">{wallet.publicKey.slice(0, 24)}…</code>
          </div>
          <div className="warning-box settings-warning">
            🔒 Your private key is kept in memory only — it will be lost when you close this tab.
          </div>
          <button
            className="btn btn-danger btn-sm"
            onClick={handleDisconnectWallet}
          >
            Unload Wallet
          </button>
        </div>
      )}

      {/* RPC endpoint */}
      <div className="card settings-section">
        <div className="section-title">RPC Endpoint</div>
        <div className="form-group">
          <label htmlFor="rpc-url">Node URL</label>
          <input
            id="rpc-url"
            className="input"
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="http://localhost:7331/rpc"
          />
        </div>
        <div className="kv-row">
          <span className="kv-key">Status</span>
          <span className="kv-val">
            <span className={`dot ${connected ? "dot-green" : "dot-red"}`} />
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        {testResult && (
          <div className={testResult.startsWith("✓") ? "success-box" : "error-box"}>
            {testResult}
          </div>
        )}
        <button
          className="btn btn-primary"
          onClick={handleSaveEndpoint}
          disabled={testing}
        >
          {testing ? "Testing…" : "Save & Test Connection"}
        </button>
      </div>

      {/* Chain info */}
      <div className="card settings-section">
        <div className="section-title">Network</div>
        <div className="kv-row">
          <span className="kv-key">Chain ID</span>
          <code className="kv-val">{chainId}</code>
        </div>
        <div className="kv-row">
          <span className="kv-key">Signature Scheme</span>
          <span className="kv-val">ML-DSA-87 (Dilithium5)</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">Key Standard</span>
          <code className="kv-val">quantix-key/v1</code>
        </div>
      </div>
    </div>
  );
}
