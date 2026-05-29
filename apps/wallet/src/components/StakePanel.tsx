/**
 * StakePanel — stake and unstake QTX with a validator.
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { parseQtx, formatQtx } from "../lib/format";
import { getNextNonce, getValidators, submitTx } from "../lib/rpc";
import type { RpcValidator } from "../lib/rpc";
import { buildStake, buildUnstake } from "../lib/tx";

export function StakePanel() {
  const { wallet, endpoint, chainId, account, refreshAccount } = useWallet();
  const [validators, setValidators] = useState<RpcValidator[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [mode, setMode] = useState<"stake" | "unstake">("stake");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingValidators, setLoadingValidators] = useState(true);

  useEffect(() => {
    setLoadingValidators(true);
    getValidators(endpoint)
      .then((vs) => {
        setValidators(vs);
        if (vs.length > 0 && !selectedId) setSelectedId(vs[0].id);
      })
      .catch(() => {/* non-fatal */})
      .finally(() => setLoadingValidators(false));
  }, [endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(async () => {
    if (!wallet || !selectedId) return;
    setError(null);
    setTxHash(null);

    let amount: bigint;
    try {
      amount = parseQtx(amountStr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid amount");
      return;
    }
    if (amount <= 0n) {
      setError("Amount must be greater than 0");
      return;
    }

    setSending(true);
    try {
      const nonce = await getNextNonce(endpoint, wallet.address);
      const builder = mode === "stake" ? buildStake : buildUnstake;
      const tx = builder({
        from: wallet.address,
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey,
        nonce,
        chainId,
        amount,
        validatorId: selectedId,
      });
      const hash = await submitTx(endpoint, tx);
      setTxHash(hash);
      setAmountStr("");
      await refreshAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [wallet, endpoint, chainId, selectedId, amountStr, mode, refreshAccount]);

  if (!wallet) return null;

  return (
    <div className="form-panel">
      <h2>Stake / Unstake</h2>

      {account && (
        <div className="stake-summary">
          <span>Currently staked: <strong>{formatQtx(account.staked)} QTX</strong></span>
        </div>
      )}

      {txHash && (
        <div className="success-box">
          <div>✓ Transaction submitted</div>
          <code className="hash-val">{txHash}</code>
        </div>
      )}
      {error && <div className="error-box">{error}</div>}

      {/* Stake / Unstake toggle */}
      <div className="mode-toggle">
        <button
          className={`btn ${mode === "stake" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setMode("stake")}
        >
          Stake
        </button>
        <button
          className={`btn ${mode === "unstake" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setMode("unstake")}
        >
          Unstake
        </button>
      </div>

      <div className="form-group">
        <label htmlFor="validator-select">Validator</label>
        {loadingValidators ? (
          <div className="skeleton">Loading validators…</div>
        ) : validators.length === 0 ? (
          <div className="hint">No validators found on this network.</div>
        ) : (
          <select
            id="validator-select"
            className="input"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={sending}
          >
            {validators.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} — {formatQtx(BigInt(v.stake))} QTX staked
                {v.active ? " ✓" : " (inactive)"}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="stake-amount">Amount (QTX)</label>
        <input
          id="stake-amount"
          className="input"
          type="text"
          placeholder="0.0"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          disabled={sending}
        />
      </div>

      <button
        className="btn btn-primary btn-full"
        onClick={handleSubmit}
        disabled={sending || !amountStr || !selectedId}
      >
        {sending ? (
          <span className="spinner-row">
            <span className="spinner" /> Processing…
          </span>
        ) : (
          mode === "stake" ? "Stake QTX" : "Unstake QTX"
        )}
      </button>
    </div>
  );
}
