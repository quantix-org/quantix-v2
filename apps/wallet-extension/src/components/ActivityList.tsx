"use client";
import { useEffect, useState } from "react";

type Activity = { hash: string; amount: string; from: string; to?: string; timestamp: number };

export default function ActivityList() {
  const [items, setItems] = useState<Activity[]>([]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "activity:list" }, (res) => {
      if (res?.ok) setItems(res.items ?? []);
    });
  }, []);

  if (!items.length) return <div className="card">No activity yet.</div>;

  return (
    <div className="card">
      {items.map((tx) => (
        <div key={tx.hash} style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div>{tx.amount} QTX</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{tx.hash}</div>
        </div>
      ))}
    </div>
  );
}
