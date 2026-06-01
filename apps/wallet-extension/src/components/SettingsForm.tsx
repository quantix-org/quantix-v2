"use client";
import { useState } from "react";

export default function SettingsForm() {
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:7330/rpc");

  const onSave = () => {
    chrome.runtime.sendMessage({ type: "settings:set", endpoint }, () => {});
  };

  return (
    <div className="card">
      <h3>Settings</h3>
      <label>RPC Endpoint</label>
      <input
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
        style={{ width: "100%", padding: 8, marginBottom: 8 }}
      />
      <button onClick={onSave}>Save</button>
    </div>
  );
}
