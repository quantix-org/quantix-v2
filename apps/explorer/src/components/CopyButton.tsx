"use client";

import { useState } from "react";

export default function CopyButton({ value }: { value: string }) {
  const [ok, setOk] = useState(false);

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setOk(true);
          window.setTimeout(() => setOk(false), 1000);
        } catch {
          setOk(false);
        }
      }}
      title="Copy"
    >
      {ok ? "copied" : "copy"}
    </button>
  );
}
