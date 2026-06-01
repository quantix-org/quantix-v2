import type { ReactNode } from "react";

export function Cell({ label, children }: { label: string; children: ReactNode }) {
  return <td data-label={label}>{children}</td>;
}
