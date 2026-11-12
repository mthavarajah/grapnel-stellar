import type { Metadata } from "next";
import "./globals.css";
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
      <body>{children}</body>
    </html>
  );
}
