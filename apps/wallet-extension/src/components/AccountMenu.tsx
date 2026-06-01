"use client";
import { useEffect, useState } from "react";

type Account = { address: string; name: string };

export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "accounts:list" }, (res) => {
      if (res?.ok) setAccounts(res.accounts ?? []);
    });
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <button className="secondary" onClick={() => setOpen((v) => !v)}>👤</button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: 40, width: 240 }}>
          {accounts.length === 0 && <div>No accounts</div>}
          {accounts.map((a) => (
            <div key={a.address} style={{ padding: 6, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div>{a.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{a.address}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
