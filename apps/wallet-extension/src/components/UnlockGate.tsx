"use client";
import { useState } from "react";

export default function UnlockGate({ children }: { children: React.ReactNode }) {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onUnlock = () => {
    chrome.runtime.sendMessage({ type: "vault:unlock", password }, (res) => {
      if (res?.ok) {
        setUnlocked(true);
        setError(null);
      } else {
        setError(res?.error ?? "Unlock failed");
      }
    });
  };

  if (!unlocked) {
    return (
      <div className="container">
        <div className="card">
          <h3>Unlock Wallet</h3>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={{ width: "100%", padding: 8, marginBottom: 8 }}
          />
          <button onClick={onUnlock}>Unlock</button>
          {error && <div style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
