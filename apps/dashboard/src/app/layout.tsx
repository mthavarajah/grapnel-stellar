import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Grapnel · Developer Console",
  icons: { icon: "/brand/logo-white.png" },
  description: "Modular financial infrastructure on Stellar Testnet.",
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
