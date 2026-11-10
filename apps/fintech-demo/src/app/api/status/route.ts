import { json } from "../../../lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  return json({
    network: "stellar-testnet",
    grapnel_configured: !!(
      process.env.GRAPNEL_API_URL && process.env.GRAPNEL_API_KEY
    ),
    privy_configured: !!(
      process.env.PRIVY_APP_ID &&
      process.env.PRIVY_APP_SECRET &&
      process.env.NEXT_PUBLIC_PRIVY_APP_ID
    ),
    session_configured: (process.env.FINTECH_SESSION_SECRET?.length ?? 0) >= 32,
  });
}
