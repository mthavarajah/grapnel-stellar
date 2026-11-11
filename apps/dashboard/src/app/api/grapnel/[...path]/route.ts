import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const routes: Record<string, string[]> = {
  "dashboard/login": ["POST"],
  "dashboard/logout": ["POST"],
  "dashboard/session": ["GET"],
  "dashboard/business": ["GET"],
  "dashboard/businesses": ["POST"],
  "dashboard/customers": ["GET"],
  "dashboard/modules": ["GET", "PATCH"],
  "dashboard/api-keys": ["GET", "POST"],
  "dashboard/requests": ["GET"],
};
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const route = path.join("/");
  const allowed =
    routes[route] ??
    (/^dashboard\/customers\/[0-9a-f-]{36}\/(?:lending-positions|balances)$/.test(route)
      ? ["GET"]
      : /^dashboard\/api-keys\/[0-9a-f-]{36}$/.test(route)
        ? ["DELETE"]
        : []);
  if (!allowed.includes(request.method))
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Route not found" } },
      { status: 404 },
    );
  const publicOrigin = new URL(
    process.env.DASHBOARD_ORIGIN ?? request.nextUrl.origin,
  ).origin;
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== publicOrigin
  )
    return NextResponse.json(
      {
        error: {
          code: "CSRF_INVALID",
          message: "Request origin does not match dashboard",
        },
      },
      { status: 403 },
    );
  const headers: Record<string, string> = { Origin: publicOrigin };
  if (request.headers.get("content-type"))
    headers["Content-Type"] = "application/json";
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("grapnel_owner="));
  if (cookie) headers.Cookie = cookie;
  const csrf = request.headers.get("x-csrf-token");
  if (csrf) headers["X-CSRF-Token"] = csrf;
  try {
    const response = await fetch(
      `${(process.env.GRAPNEL_API_URL ?? "http://localhost:3001").replace(/\/$/, "")}/v1/${route}`,
      {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.text(),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const out = new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
    for (const value of response.headers.getSetCookie())
      out.headers.append("Set-Cookie", value);
    const id = response.headers.get("x-request-id");
    if (id) out.headers.set("X-Request-ID", id);
    return out;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "API_UNAVAILABLE",
          message:
            "Grapnel API is unreachable. Check the server connection and try again.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
