"use client";
import { useState, useEffect } from "react";
import { getLatestBlock, getBlock, getMempool, getValidators, type RpcBlock, type RpcTx, type RpcValidator } from "@/lib/rpc";
import { formatQtx, shortAddress, shortHash } from "@/lib/format";

type Tab = "blocks" | "mempool" | "validators";

export default function ExplorerPanel() {
  const [tab, setTab] = useState<Tab>("blocks");
  const [blocks, setBlocks] = useState<RpcBlock[]>([]);
  const [mempool, setMempool] = useState<RpcTx[]>([]);
  const [validators, setValidators] = useState<RpcValidator[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        if (tab === "blocks") {
          const latest = await getLatestBlock();
          const heights = [];
          for (let h = latest.height; h >= Math.max(0, latest.height - 9); h--) {
            heights.push(h);
          }
          const fetched: RpcBlock[] = [];
          for (const h of heights) {
            try { fetched.push(await getBlock(h)); } catch { /* skip */ }
          }
          if (!cancelled) setBlocks(fetched);
        } else if (tab === "mempool") {
          const mp = await getMempool();
          if (!cancelled) setMempool(mp);
        } else {
          const vs = await getValidators();
          if (!cancelled) setValidators(vs);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [tab]);

  return (
    <div>
      <div className="tab-row" style={{ marginBottom: 14 }}>
        {(["blocks", "mempool", "validators"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab-inner ${tab === t ? "tab-inner-active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {err && <div className="error-text" style={{ marginBottom: 10 }}>{err}</div>}

      {tab === "blocks" && (
        <div className="card">
          <div className="card-head">Recent Blocks</div>
          {loading && blocks.length === 0
            ? <div className="loading-row"><span className="spinner" /></div>
            : blocks.length === 0
            ? <div className="empty">No blocks yet</div>
            : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Height</th>
                    <th>Hash</th>
                    <th>Time</th>
                    <th>Txs</th>
                    <th>Proposer</th>
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((b) => (
                    <tr key={b.hash}>
                      <td><span className="badge b-blue">#{b.height}</span></td>
                      <td>{shortHash(b.hash, 12)}</td>
                      <td>{new Date(b.timestamp).toLocaleTimeString()}</td>
                      <td>{b.txCount}</td>
                      <td>{shortAddress(b.proposer || undefined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

      {tab === "mempool" && (
        <div className="card">
          <div className="card-head">Mempool — {mempool.length} pending tx{mempool.length !== 1 ? "s" : ""}</div>
          {loading && mempool.length === 0
            ? <div className="loading-row"><span className="spinner" /></div>
            : mempool.length === 0
            ? <div className="empty">Mempool is empty</div>
            : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Amount</th>
                    <th>Nonce</th>
                  </tr>
                </thead>
                <tbody>
                  {mempool.map((tx, i) => (
                    <tr key={i}>
                      <td><span className={`badge ${txBadge(tx.type)}`}>{tx.type}</span></td>
                      <td>{shortAddress(tx.from)}</td>
                      <td>{tx.to ? shortAddress(tx.to) : "—"}</td>
                      <td>{formatQtx(BigInt(tx.amount))} QTX</td>
                      <td>{tx.nonce}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

      {tab === "validators" && (
        <div className="card">
          <div className="card-head">Validators — {validators.filter((v) => v.active).length} active</div>
          {loading && validators.length === 0
            ? <div className="loading-row"><span className="spinner" /></div>
            : validators.length === 0
            ? <div className="empty">No validators registered</div>
            : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Stake</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {validators.map((v) => (
                    <tr key={v.address}>
                      <td>{shortAddress(v.address)}</td>
                      <td>{formatQtx(BigInt(v.stake))} QTX</td>
                      <td>
                        <span className={`badge ${v.active ? "b-green" : "b-gray"}`}>
                          {v.active ? "active" : "inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}
    </div>
  );
}

function txBadge(type: string) {
  switch (type) {
    case "transfer": return "b-blue";
    case "stake": return "b-green";
    case "unstake": return "b-orange";
    case "validator_register": return "b-red";
    default: return "b-gray";
  }
}
