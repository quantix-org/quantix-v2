"use client";
import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { walletFileToKeyPair, signPayload } from "@/lib/crypto";
import { parseQtx, formatQtx } from "@/lib/format";
import {
  getNextNonce,
  submitTx,
  transactionSigningPayload,
  type WireTx,
} from "@/lib/rpc";

const CHAIN_ID = "quantix-devnet";
const BASE_FEE = 1n; // 1 base unit

export default function SendPanel() {
  const { wallet, balance, refresh } = useWallet();

  const [to, setTo] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [feeStr, setFeeStr] = useState("0");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const available = balance?.balance ? BigInt(balance.balance) : null;

  async function handleSend() {
    if (!wallet) return;
    setErr(null);
    setTxHash(null);

    let amount: bigint;
    let extraFee: bigint;
    try {
      amount = parseQtx(amountStr);
      extraFee = parseQtx(feeStr || "0");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid amount");
      return;
    }

    if (amount <= 0n) { setErr("Amount must be > 0"); return; }
    if (!to.startsWith("qtx1") || to.length !== 42) {
      setErr("Recipient must be a valid qtx1… address (42 chars)");
      return;
    }

    const totalFee = BASE_FEE + extraFee;
    const total = amount + totalFee;
    if (available !== null && total > available) {
      setErr(`Insufficient balance (need ${formatQtx(total)} QTX, have ${formatQtx(available)} QTX)`);
      return;
    }

    setBusy(true);
    try {
      const nonce = await getNextNonce(wallet.address);
      const timestamp = Date.now();

      const unsigned = {
        type: "transfer" as const,
        chainId: CHAIN_ID,
        from: wallet.address,
        nonce,
        timestamp,
        amount,
        fee: totalFee,
        to,
      };

      const payload = transactionSigningPayload(unsigned);
      const kp = walletFileToKeyPair(wallet);
      const signature = signPayload(kp.privateKey, payload);

      const wireTx: WireTx = {
        ...unsigned,
        amount: amount.toString(),
        fee: totalFee.toString(),
        signerPublicKey: wallet.publicKey,
        signature,
      };

      const result = await submitTx(wireTx);
      setTxHash(result.txHash);
      setTo("");
      setAmountStr("");
      setFeeStr("0");
      setTimeout(refresh, 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card panel-card">
      <h2>Send QTX</h2>
      <p className="sub">Transfer QTX to another address on Quantix devnet.</p>

      {available !== null && (
        <div className="avail-row">Available: <span>{formatQtx(available)} QTX</span></div>
      )}

      <div className="field">
        <label>Recipient address</label>
        <input
          className="input"
          placeholder="qtx1…"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          disabled={busy}
        />
      </div>

      <div className="field">
        <label>Amount (QTX)</label>
        <input
          className="input"
          placeholder="0.0"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="field">
        <label>Extra fee (QTX) — optional</label>
        <input
          className="input"
          placeholder="0"
          value={feeStr}
          onChange={(e) => setFeeStr(e.target.value)}
          disabled={busy}
        />
        <div className="hint-text">Base fee: 0.000000000000000001 QTX. Extra fee speeds up inclusion.</div>
      </div>

      {err && <div className="error-text">{err}</div>}

      {txHash && (
        <div className="tx-result">
          <div className="success">✓ Transaction submitted</div>
          <div className="hash">tx: {txHash}</div>
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={handleSend}
        disabled={busy || !wallet || !amountStr || !to}
        style={{ marginTop: 8 }}
      >
        {busy ? <span className="spinner-row"><span className="spinner" /> Sending…</span> : "Send"}
      </button>
    </div>
  );
}
