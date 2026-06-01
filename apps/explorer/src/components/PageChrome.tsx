import type { ReactNode } from "react";
import LiveRefresh from "./LiveRefresh";
import TopBar from "./TopBar";

export default function PageChrome({
  active,
  children,
}: {
  active?: "home" | "validators" | "rewards";
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <TopBar active={active} right={<LiveRefresh />} />
      <main className="main-content">{children}</main>
    </div>
  );
}
