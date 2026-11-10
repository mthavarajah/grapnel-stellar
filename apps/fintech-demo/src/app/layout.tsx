import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Local Finance · Stellar Testnet",
  description:
    "An independent sample fintech built with Grapnel APIs on Stellar Testnet. Testnet tokens only, no real money.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
