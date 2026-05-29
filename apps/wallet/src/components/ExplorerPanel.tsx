/**
 * ExplorerPanel — view validators, mempool, and latest block details.
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { formatQtx, shortAddress, shortHash } from "../lib/format";
import { getValidators, getMempool, getLatestBlock } from "../lib/rpc";
import type { RpcValidator, RpcMempoolEntry, RpcBlock } from "../lib/rpc";

export function ExplorerPanel() {
  const { endpoint, connected } = useWallet();
  const [validators, setValidators] = useState<RpcValidator[]>([]);
  const [mempool, setMempool] = useState<RpcMempoolEntry[]>([]);
  const [block, setBlock] = useState<RpcBlock | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const [vs, mp, blk] = await Promise.all([
        getValidators(endpoint),
        getMempool(endpoint),
        getLatestBlock(endpoint),
      ]);
      setValidators(vs);
      setMempool(mp);
      setBlock(blk);
    } catch {
      // non-fatal — errors shown inline
    } finally {
      setLoading(false);
    }
  }, [endpoint, connected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="explorer-panel">
      <div className="explorer-header">
        <h2>Explorer</h2>
        <button
          className="btn btn-ghost btn-sm"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? "…" : "↺ Refresh"}
        </button>
      </div>

      {/* Latest block */}
      {block && (
        <div className="card explorer-block">
          <div className="section-title">Latest Block #{block.height}</div>
          <div className="kv-row">
            <span className="kv-key">Hash</span>
            <code className="kv-val">{shortHash(block.hash, 12)}</code>
          </div>
          <div className="kv-row">
            <span className="kv-key">Proposer</span>
            <code className="kv-val">{shortAddress(block.proposer || undefined)}</code>
          </div>
          <div className="kv-row">
            <span className="kv-key">Transactions</span>
            <span className="kv-val">{block.txCount}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Time</span>
            <span className="kv-val">
              {new Date(block.timestamp).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Validators */}
      <div className="card">
        <div className="section-title">Validators ({validators.length})</div>
        {validators.length === 0 ? (
          <div className="hint">{loading ? "Loading…" : "No validators found."}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Address</th>
                  <th>Stake</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {validators.map((v) => (
                  <tr key={v.id}>
                    <td><code>{v.id}</code></td>
                    <td><code>{shortAddress(v.address)}</code></td>
                    <td>{formatQtx(BigInt(v.stake))} QTX</td>
                    <td>
                      <span className={`badge ${v.active ? "badge-green" : "badge-grey"}`}>
                        {v.active ? "active" : "inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mempool */}
      <div className="card">
        <div className="section-title">Mempool ({mempool.length} pending)</div>
        {mempool.length === 0 ? (
          <div className="hint">{loading ? "Loading…" : "Mempool is empty."}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Hash</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {mempool.map((tx) => (
                  <tr key={tx.hash}>
                    <td><code>{shortHash(tx.hash, 8)}</code></td>
                    <td><span className="badge badge-purple">{tx.type}</span></td>
                    <td><code>{shortAddress(tx.from)}</code></td>
                    <td>{formatQtx(BigInt(tx.amount))} QTX</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
