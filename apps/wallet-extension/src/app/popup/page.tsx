import TopBar from "@/components/TopBar";
import UnlockGate from "@/components/UnlockGate";
import BalanceCard from "@/components/BalanceCard";
import ActivityList from "@/components/ActivityList";

export default function PopupPage() {
  return (
    <UnlockGate>
      <TopBar connected={true} />
      <div className="container">
        <BalanceCard />
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button>Send</button>
          <button className="secondary">Receive</button>
        </div>
        <ActivityList />
      </div>
    </UnlockGate>
  );
}
