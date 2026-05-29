/**
 * SendPanel — compose and broadcast a transfer transaction.
 */

import { useCallback, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { parseQtx, ONE_QTX } from "../lib/format";
import { getNextNonce, submitTx } from "../lib/rpc";
import { buildTransfer } from "../lib/tx";

export function SendPanel() {
  const { wallet, endpoint, chainId, refreshAccount } = useWallet();
  const [to, setTo] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = useCallback(async () => {
    if (!wallet) return;
    setError(null);
    setTxHash(null);

    // Validate inputs
    if (!to.startsWith("qtx1")) {
      setError("Recipient must be a Quantix address starting with qtx1");
      return;
    }
    let amount: bigint;
    try {
      amount = parseQtx(amountStr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid amount");
      return;
    }
    if (amount < ONE_QTX / 1000n) {
      setError("Amount too small (minimum 0.001 QTX)");
      return;
    }

    setSending(true);
    try {
      const nonce = await getNextNonce(endpoint, wallet.address);
      const tx = buildTransfer({
        from: wallet.address,
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey,
        nonce,
        chainId,
        to,
        amount,
      });
      const hash = await submitTx(endpoint, tx);
      setTxHash(hash);
      setTo("");
      setAmountStr("");
      await refreshAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [wallet, endpoint, chainId, to, amountStr, refreshAccount]);

  if (!wallet) return null;

  return (
    <div className="form-panel">
      <h2>Send QTX</h2>

      {txHash && (
        <div className="success-box">
          <div>✓ Transaction submitted</div>
          <code className="hash-val">{txHash}</code>
        </div>
      )}
      {error && <div className="error-box">{error}</div>}

      <div className="form-group">
        <label htmlFor="send-to">Recipient Address</label>
        <input
          id="send-to"
          className="input"
          type="text"
          placeholder="qtx1…"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          disabled={sending}
        />
      </div>

      <div className="form-group">
        <label htmlFor="send-amount">Amount (QTX)</label>
        <input
          id="send-amount"
          className="input"
          type="text"
          placeholder="0.0"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          disabled={sending}
        />
      </div>

      <div className="fee-note">Network fee: 0.000000000000001 QTX (1000 base units)</div>

      <button
        className="btn btn-primary btn-full"
        onClick={handleSend}
        disabled={sending || !to || !amountStr}
      >
        {sending ? (
          <span className="spinner-row">
            <span className="spinner" /> Signing & Broadcasting…
          </span>
        ) : (
          "Send"
        )}
      </button>
    </div>
  );
}
