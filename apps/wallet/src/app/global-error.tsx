"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: "#0d1117", color: "#e6edf3", fontFamily: "sans-serif", padding: "40px 24px" }}>
        <h2 style={{ marginBottom: 12 }}>Something went wrong</h2>
        <p style={{ color: "#8b949e", marginBottom: 20, fontSize: 14 }}>{error.message}</p>
        <button
          onClick={reset}
          style={{ background: "#4f8ef7", color: "#fff", border: "none", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
