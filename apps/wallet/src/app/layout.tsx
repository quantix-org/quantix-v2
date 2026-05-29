import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quantix Wallet",
  description: "Post-quantum ML-DSA-87 wallet for Quantix devnet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
