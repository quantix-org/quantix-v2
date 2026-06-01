"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LiveRefresh({ interval = 4000 }: { interval?: number }) {
  const router = useRouter();
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lastHeight: number | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/rpc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "qtx_getLatestBlock", params: [] }),
        });
        const json = (await res.json()) as { result?: { height?: number } };
        const nextHeight = json.result?.height ?? null;
        if (!cancelled) {
          setOnline(true);
          if (lastHeight !== null && nextHeight !== null && nextHeight !== lastHeight) {
            router.refresh();
          }
          lastHeight = nextHeight;
        }
      } catch {
        if (!cancelled) setOnline(false);
      }
    }

    tick();
    const id = window.setInterval(tick, interval);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [interval, router]);

  return <span className={`conn-badge ${online ? "conn-ok" : "conn-bad"}`}>{online ? "live" : "offline"}</span>;
}
