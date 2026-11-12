import type { Metadata } from "next";
import "./globals.css";
import {FintechProviders} from "../components/fintech-providers";
export const metadata: Metadata = {
  title: "Velocity",
  icons: {icon:"/brand/velocity-official-icon.png"},
  description:
    "Your balances, markets and savings in one place.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body><FintechProviders>{children}</FintechProviders></body>
    </html>
  );
}
