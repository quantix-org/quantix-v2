import Link from "next/link";
import type { ReactNode } from "react";
import SearchBar from "./SearchBar";

export default function TopBar({ active, right }: { active?: "home" | "validators" | "rewards"; right?: ReactNode }) {
  return (
    <header className="topbar">
      <Link className="logo" href="/">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 1.5L17.5 5.5V14.5L10 18.5L2.5 14.5V5.5Z" stroke="#4f8ef7" strokeWidth="1.4" fill="rgba(79,142,247,.08)" />
          <circle cx="10" cy="10" r="2.5" fill="#4f8ef7" />
        </svg>
        Quantix Explorer
      </Link>
      <nav className="tab-nav" aria-label="Explorer sections">
        <Link className={`tab-btn ${active === "home" ? "tab-active" : ""}`} href="/">Home</Link>
        <Link className={`tab-btn ${active === "validators" ? "tab-active" : ""}`} href="/validators">Validators</Link>
        <Link className={`tab-btn ${active === "rewards" ? "tab-active" : ""}`} href="/rewards">Rewards</Link>
      </nav>
      <SearchBar />
      {right}
    </header>
  );
}
