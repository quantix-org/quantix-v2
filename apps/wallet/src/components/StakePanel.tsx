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
const BASE_FEE = 1n;
const MIN_STAKE = 32n * 10n ** 18n; // 32 QTX

type Tab = "stake" | "unstake" | "register";

export default function StakePanel() {
  const { wallet, balance, refresh } = useWallet();
  const [tab, setTab] = useState<Tab>("stake");
  const [amountStr, setAmountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const available = balance?.balance ? BigInt(balance.balance) : null;
  const staked = balance?.staked ? BigInt(balance.staked) : null;

  function reset() {
    setAmountStr("");
    setTxHash(null);
    setErr(null);
  }

  async function handleSubmit() {
    if (!wallet) return;
    setErr(null);
    setTxHash(null);

    let amount: bigint;
    if (tab === "register") {
      amount = MIN_STAKE;
    } else {
      try {
        amount = parseQtx(amountStr);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Invalid amount");
        return;
      }
      if (amount <= 0n) { setErr("Amount must be > 0"); return; }
    }

    setBusy(true);
    try {
      const nonce = await getNextNonce(wallet.address);
      const timestamp = Date.now();

      const txType =
        tab === "stake" ? "stake" :
        tab === "unstake" ? "unstake" :
        "validator_register";

      const unsigned = {
        type: txType as "stake" | "unstake" | "validator_register",
        chainId: CHAIN_ID,
        from: wallet.address,
        nonce,
        timestamp,
        amount,
        fee: BASE_FEE,
        validatorId: tab === "register" ? wallet.address : undefined,
      };

      const payload = transactionSigningPayload(unsigned);
      const kp = walletFileToKeyPair(wallet);
      const signature = signPayload(kp.privateKey, payload);

      const wireTx: WireTx = {
        ...unsigned,
        amount: amount.toString(),
        fee: BASE_FEE.toString(),
        signerPublicKey: wallet.publicKey,
        signature,
      };

      const result = await submitTx(wireTx);
      setTxHash(result.txHash);
      setAmountStr("");
      setTimeout(refresh, 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card panel-card">
      <h2>Stake / Validate</h2>
      <p className="sub">Stake QTX to earn rewards or register as a validator.</p>

      <div className="staked-info">
        <div className="lbl">Currently staked</div>
        <div className="val">{staked !== null ? formatQtx(staked) : "—"}<span className="sub"> QTX</span></div>
      </div>

      <div className="tab-row">
        {(["stake", "unstake", "register"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab-inner ${tab === t ? "tab-inner-active" : ""}`}
            onClick={() => { setTab(t); reset(); }}
          >
            {t === "stake" ? "Stake" : t === "unstake" ? "Unstake" : "Register validator"}
          </button>
        ))}
      </div>

      {tab === "register" ? (
        <div>
          <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
            Registers your address as a validator. Requires a minimum stake of{" "}
            <strong style={{ color: "var(--text)" }}>32 QTX</strong> which will be locked.
          </p>
          {available !== null && (
            <div className="avail-row">Available: <span>{formatQtx(available)} QTX</span></div>
          )}
        </div>
      ) : (
        <div>
          {available !== null && tab === "stake" && (
            <div className="avail-row">Available: <span>{formatQtx(available)} QTX</span></div>
          )}
          {staked !== null && tab === "unstake" && (
            <div className="avail-row">Staked: <span>{formatQtx(staked)} QTX</span></div>
          )}
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
        </div>
      )}

      {err && <div className="error-text">{err}</div>}

      {txHash && (
        <div className="tx-result">
          <div className="success">✓ Transaction submitted</div>
          <div className="hash">tx: {txHash}</div>
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={handleSubmit}
        disabled={busy || !wallet || (tab !== "register" && !amountStr)}
        style={{ marginTop: 8 }}
      >
        {busy
          ? <span className="spinner-row"><span className="spinner" /> Processing…</span>
          : tab === "stake" ? "Stake"
          : tab === "unstake" ? "Unstake"
          : "Register validator"}
      </button>
    </div>
  );
}
