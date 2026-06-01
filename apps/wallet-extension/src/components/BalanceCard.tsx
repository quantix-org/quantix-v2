"use client";
import { useEffect, useState } from "react";

export default function BalanceCard() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("0");
  const [endpoint, setEndpoint] = useState<string>("http://127.0.0.1:7330/rpc");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "accounts:list" }, (res) => {
      if (res?.ok && res.active) setAddress(res.active);
    });
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "settings:get" }, (res) => {
      if (res?.ok && res.endpoint) setEndpoint(res.endpoint);
    });
  }, []);

  useEffect(() => {
    if (!address) return;
    chrome.runtime.sendMessage(
      { type: "rpc:call", endpoint, method: "qtx_getBalance", params: [address] },
      (res) => {
        if (res?.ok) setBalance(res.result?.balance ?? "0");
      }
    );
  }, [address, endpoint]);

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ color: "var(--muted)" }}>Address</div>
      <div style={{ fontSize: 12, marginBottom: 8 }}>{address ?? "-"}</div>
      <div style={{ color: "var(--muted)" }}>Balance</div>
      <div style={{ fontSize: 20 }}>{balance} QTX</div>
    </div>
  );
}
