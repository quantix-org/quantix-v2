/**
 * DashboardPanel — account overview with balance, staked, and latest block.
 */

import { useCallback, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { formatQtx, shortAddress } from "../lib/format";

export function DashboardPanel() {
  const { wallet, account, latestBlock, connected, refreshAccount, refreshBlock } =
    useWallet();
  const [copying, setCopying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const copyAddress = useCallback(async () => {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopying(true);
    setTimeout(() => setCopying(false), 1500);
  }, [wallet]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshAccount(), refreshBlock()]);
    setRefreshing(false);
  }, [refreshAccount, refreshBlock]);

  if (!wallet) return null;

  return (
    <div className="dashboard-panel">
      {/* Address card */}
      <div className="card address-card">
        <div className="address-label">Your Address</div>
        <div className="address-row">
          <code className="address-full">{wallet.address}</code>
          <button
            className="btn btn-ghost btn-sm"
            onClick={copyAddress}
            title="Copy address"
          >
            {copying ? "✓" : "⧉"}
          </button>
        </div>
        <div className="address-short">{shortAddress(wallet.address, 8)}</div>
      </div>

      {/* Balance grid */}
      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-label">Balance</div>
          <div className="stat-value">
            {account ? (
              <>
                <span className="stat-num">{formatQtx(account.balance)}</span>
                <span className="stat-unit"> QTX</span>
              </>
            ) : (
              <span className="skeleton">——</span>
            )}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Staked</div>
          <div className="stat-value">
            {account ? (
              <>
                <span className="stat-num">{formatQtx(account.staked)}</span>
                <span className="stat-unit"> QTX</span>
              </>
            ) : (
              <span className="skeleton">——</span>
            )}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Latest Block</div>
          <div className="stat-value">
            {latestBlock ? (
              <>
                <span className="stat-num">#{latestBlock.height}</span>
                <span className="stat-meta">
                  {" "}
                  · {latestBlock.txCount} tx
                </span>
              </>
            ) : (
              <span className="skeleton">——</span>
            )}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Node</div>
          <div className="stat-value">
            <span
              className={`dot ${connected ? "dot-green" : "dot-red"}`}
            />
            {connected ? "Connected" : "Disconnected"}
          </div>
        </div>
      </div>

      {latestBlock && (
        <div className="card block-card">
          <div className="block-header">
            <span className="block-title">Latest Block</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh"
            >
              {refreshing ? "…" : "↺"}
            </button>
          </div>
          <div className="block-detail">
            <span className="meta-label">Hash</span>
            <code className="meta-val">{latestBlock.hash.slice(0, 32)}…</code>
          </div>
          <div className="block-detail">
            <span className="meta-label">Validator</span>
            <code className="meta-val">{shortAddress(latestBlock.proposer || undefined)}</code>
          </div>
          <div className="block-detail">
            <span className="meta-label">Time</span>
            <span className="meta-val">
              {new Date(latestBlock.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
