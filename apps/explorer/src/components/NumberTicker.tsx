"use client";

import { useEffect, useRef, useState } from "react";

type NumberTickerProps = {
  value: number;
  durationMs?: number;
  className?: string;
  formatter?: (value: number) => string;
};

export default function NumberTicker({
  value,
  durationMs,
  className,
  formatter = (v) => v.toLocaleString(),
}: NumberTickerProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const from = previousValueRef.current;
    const to = value;

    if (from === to) {
      setDisplayValue(to);
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayValue(to);
      previousValueRef.current = to;
      return;
    }

    const delta = to - from;
    const computedDuration =
      durationMs ?? Math.max(320, Math.min(1200, 520 + Math.abs(delta) * 10));

    let rafId = 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / computedDuration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + delta * eased;
      const rounded = delta >= 0 ? Math.floor(next) : Math.ceil(next);
      setDisplayValue(rounded);

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setDisplayValue(to);
        previousValueRef.current = to;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value, durationMs]);

  return <span className={className}>{formatter(displayValue)}</span>;
}
