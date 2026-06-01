import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quantix Explorer",
  description: "Standalone Next.js explorer for the Quantix network",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
