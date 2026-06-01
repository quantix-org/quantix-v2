import Link from "next/link";
import PageChrome from "@/components/PageChrome";

export default function NotFound() {
  return (
    <PageChrome>
      <div className="err">Page not found.</div>
      <div style={{ marginTop: 12 }}>
        <Link href="/">Back to explorer home</Link>
      </div>
    </PageChrome>
  );
}
