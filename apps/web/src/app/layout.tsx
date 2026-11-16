import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Web3Providers } from "@/components/providers/Web3Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "EvidenceBound Escrow",
  description: "Local research UI for evidence-bound blockchain escrow (mock tokens only).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Web3Providers>
          <div className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">{children}</div>
        </Web3Providers>
      </body>
    </html>
  );
}
