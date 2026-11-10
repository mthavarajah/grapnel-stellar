import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@grapnel/contracts"],
  experimental: { optimizePackageImports: ["@privy-io/react-auth"] },
};
export default config;
