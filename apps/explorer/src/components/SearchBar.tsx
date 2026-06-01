"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function resolvePath(input: string): string {
  const q = input.trim();
  if (!q) return "/";
  if (/^[0-9]+$/.test(q)) return `/block/${q}`;
  if (/^qtxContract/i.test(q)) return `/address/${q}`;
  if (/^qtx/i.test(q)) return `/address/${q}`;
  return `/tx/${q}`;
}

export default function SearchBar() {
  const router = useRouter();
  const [value, setValue] = useState("");

  return (
    <form
      className="search-box"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(resolvePath(value));
      }}
    >
      <button type="submit" title="Search">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </button>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Address / Tx hash / Block height…"
        spellCheck={false}
        autoComplete="off"
      />
    </form>
  );
}
