import TopBar from "@/components/TopBar";
import UnlockGate from "@/components/UnlockGate";
import SettingsForm from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <UnlockGate>
      <TopBar connected={true} />
      <div className="container">
        <SettingsForm />
      </div>
    </UnlockGate>
  );
}
