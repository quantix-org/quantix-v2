"use client";
import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { formatQtx, shortAddress, shortHash } from "@/lib/format";
import { requestFaucet } from "@/lib/rpc";

export default function DashboardPanel() {
  const { wallet, balance, latestBlock, connected, loading, refresh } = useWallet();
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);
  const [faucetTxHash, setFaucetTxHash] = useState<string | null>(null);

  const available = balance?.balance ? BigInt(balance.balance) : null;
  const staked = balance?.staked ? BigInt(balance.staked) : null;

  async function handleFaucet() {
    if (!wallet) return;
    setFaucetBusy(true);
    setFaucetError(null);
    setFaucetTxHash(null);
    try {
      const result = await requestFaucet(wallet.address);
      setFaucetTxHash(result.txHash);
      setTimeout(() => {
        void refresh();
      }, 1500);
    } catch (e) {
      setFaucetError(e instanceof Error ? e.message : String(e));
    } finally {
      setFaucetBusy(false);
    }
  }

  return (
    <div>
      {/* Account card */}
      <div className="card account-card">
        <div className="account-name">Account</div>
        <div className="address-short">{wallet?.address ?? "—"}</div>
        <div className="balances">
          <div className="bal-item">
            <div className="bal-label">Available</div>
            <div className="bal-value">
              {available !== null ? formatQtx(available) : "—"}
              <span className="bal-unit">QTX</span>
            </div>
          </div>
          <div className="bal-item">
            <div className="bal-label">Staked</div>
            <div className="bal-value">
              {staked !== null ? formatQtx(staked) : "—"}
              <span className="bal-unit">QTX</span>
            </div>
          </div>
        </div>
        <div className="conn-row">
          <div className={`dot ${connected ? "dot-green" : "dot-red"}`} />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {connected ? "Connected to node" : "Node unreachable"}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={handleFaucet}
            disabled={faucetBusy || !wallet}
            title="Fund this wallet once with 10 QTX"
          >
            {faucetBusy ? <span className="spinner" /> : "🚰 Faucet +10 QTX"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : "↻ Refresh"}
          </button>
        </div>
        {faucetError && <div className="error-text" style={{ marginTop: 8 }}>{faucetError}</div>}
        {faucetTxHash && (
          <div className="hint-text" style={{ marginTop: 8 }}>
            Faucet tx submitted: {shortHash(faucetTxHash, 14)}
          </div>
        )}
      </div>

      {/* Latest block */}
      <div className="card block-card">
        <div className="block-header">
          <div className="block-title">Latest Block</div>
          {latestBlock && (
            <span className="badge b-blue">#{latestBlock.height}</span>
          )}
        </div>
        {latestBlock ? (
          <>
            <div className="block-detail">
              <span className="meta-label">Hash</span>
              <span className="meta-val">{shortHash(latestBlock.hash, 12)}</span>
            </div>
            <div className="block-detail">
              <span className="meta-label">Time</span>
              <span className="meta-val">{new Date(latestBlock.timestamp).toLocaleString()}</span>
            </div>
            <div className="block-detail">
              <span className="meta-label">Tx count</span>
              <span className="meta-val">{latestBlock.txCount}</span>
            </div>
            <div className="block-detail">
              <span className="meta-label">Proposer</span>
              <span className="meta-val">{shortAddress(latestBlock.proposer || undefined)}</span>
            </div>
          </>
        ) : (
          <div className="empty">{loading ? "Loading…" : "No blocks yet"}</div>
        )}
      </div>

      {/* Nonce */}
      {balance && (
        <div className="card">
          <div className="card-head">Account Info</div>
          <div style={{ padding: "12px 16px", display: "flex", gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>NONCE</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 16, fontWeight: 700 }}>{balance.nonce}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
