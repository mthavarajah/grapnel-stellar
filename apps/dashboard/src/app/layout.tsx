import type { Metadata } from "next";
import "./globals.css";
import {DashboardRouter} from "../components/dashboard-router";
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
      <body><DashboardRouter/>{children}</body>
    </html>
  );
}
