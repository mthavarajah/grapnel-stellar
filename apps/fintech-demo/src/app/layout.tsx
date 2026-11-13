import {Suspense} from 'react';
import {FinanceRouter} from '../components/finance-router';
import {ProgressIndicator} from '../components/operation-progress';
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
      <body><FintechProviders><Suspense fallback={<main className="initial-loading"><ProgressIndicator label="Opening account" spinning/></main>}><FinanceRouter>{children}</FinanceRouter></Suspense></FintechProviders></body>
    </html>
  );
}
