import { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertOrigin,
  BffError,
  clearSession,
  failure,
  grapnel,
  json,
  requireSession,
  setSession,
  verifyIdentity,
  type CustomerSession,
} from "../../../lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const s = await requireSession();
    return json({
      customer_id: s.customerId,
      wallet_id: s.walletId,
      stellar_address: s.address,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const body = z
      .object({ identity_token: z.string().min(1).max(32768) })
      .strict()
      .parse(await request.json());
    const userId = await verifyIdentity(body.identity_token);
    const customer = await grapnel("/customers", undefined, {
      method: "POST",
      body: { external_customer_id: userId },
    });
    const temporary = { identityToken: body.identity_token } as CustomerSession;
    const wallet = await grapnel("/capital/wallets", temporary, {
      method: "POST",
      body: {
        customer_id: customer.customer_id,
        privy_identity_proof: body.identity_token,
      },
    });
    const jwt = JSON.parse(
      Buffer.from(
        body.identity_token.split(".")[1] ?? "",
        "base64url",
      ).toString("utf8"),
    );
    const expiresAt = Math.min(Date.now() + 3600000, Number(jwt.exp) * 1000);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new BffError(
        401,
        "INVALID_CUSTOMER_IDENTITY",
        "Your session has expired. Please sign in again",
      );
    const session: CustomerSession = {
      userId,
      customerId: customer.customer_id,
      walletId: wallet.wallet_id,
      address: wallet.stellar_address,
      identityToken: body.identity_token,
      expiresAt,
    };
    const response = json({
      customer_id: session.customerId,
      wallet_id: session.walletId,
      stellar_address: session.address,
    });
    setSession(response, session);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError)
      return failure(
        new BffError(
          422,
          "VALIDATION_ERROR",
          "Please sign in to continue",
        ),
      );
    return failure(error);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    assertOrigin(request);
    const response = json({ logged_out: true });
    clearSession(response);
    return response;
  } catch (error) {
    return failure(error);
  }
}
