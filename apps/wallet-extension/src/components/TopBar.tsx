import AccountMenu from "./AccountMenu";

export default function TopBar({ connected }: { connected: boolean }) {
  return (
    <div className="topbar">
      <div>⚛ Quantix</div>
      <div className={connected ? "badge-ok" : "badge-bad"}>
        {connected ? "● Connected" : "○ Offline"}
      </div>
      <AccountMenu />
    </div>
  );
}
