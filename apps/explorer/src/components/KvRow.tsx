import type { ReactNode } from "react";

export default function KvRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kv-row">
      <div className="kv-key">{label}</div>
      <div className="kv-val">{value}</div>
    </div>
  );
}
