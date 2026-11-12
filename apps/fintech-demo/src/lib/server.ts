import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import { PrivyClient } from "@privy-io/node";
import { NextRequest, NextResponse } from "next/server";
export class BffError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: {operation_id:string},
  ) {
    super(message);
  }
}
export interface CustomerSession {
  userId: string;
  customerId: string;
  walletId: string;
  address: string;
  identityToken: string;
  expiresAt: number;
}
const cookieName = "local_finance_session";
const chunkSize = 3000;
const maxChunks = 4;
const maxSealedLength = chunkSize * maxChunks;
export const SESSION_COOKIE_NAMES = [
  cookieName,
  ...Array.from({ length: maxChunks }, (_, i) => `${cookieName}.${i}`),
];
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});
function sessionKey(): Buffer {
  const secret = process.env.FINTECH_SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new BffError(
      503,
      "SETUP_REQUIRED",
      "Customer sessions require FINTECH_SESSION_SECRET",
    );
  return createHash("sha256").update(secret).digest();
}
export function sealSession(session: CustomerSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), body]).toString(
    "base64url",
  );
  if (sealed.length > maxSealedLength)
    throw new BffError(
      413,
      "CUSTOMER_SESSION_TOO_LARGE",
      "Your session could not be saved. Please sign in again",
    );
  return sealed;
}
export function openSession(value: string): CustomerSession {
  try {
    if (
      !value ||
      value.length > maxSealedLength ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw Error();
    const data = Buffer.from(value, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      sessionKey(),
      data.subarray(0, 12),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    const result = JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      typeof result.expiresAt !== "number" ||
      !Number.isFinite(result.expiresAt) ||
      result.expiresAt <= Date.now() ||
      !result.userId ||
      !result.customerId ||
      !result.walletId ||
      !result.identityToken ||
      ![
        result.userId,
        result.customerId,
        result.walletId,
        result.address,
        result.identityToken,
      ].every((value) => typeof value === "string")
    )
      throw Error();
    return result;
  } catch {
    throw new BffError(
      401,
      "CUSTOMER_SESSION_REQUIRED",
      "Sign in again to continue",
    );
  }
}
/** Bounded chunks avoid the browser's 4096-byte per-cookie limit. Whole-session
 * authenticated encryption still protects ordering, completeness, and contents. */
export function sessionCookieValues(
  session: CustomerSession,
): Record<string, string> {
  const sealed = sealSession(session);
  const count = Math.ceil(sealed.length / chunkSize);
  return Object.fromEntries([
    [cookieName, `v1:${count}`],
    ...Array.from({ length: count }, (_, i) => [
      `${cookieName}.${i}`,
      sealed.slice(i * chunkSize, (i + 1) * chunkSize),
    ]),
  ]);
}
export function readSessionCookies(
  get: (name: string) => string | undefined,
): CustomerSession {
  const metadata = get(cookieName);
  if (!metadata)
    throw new BffError(
      401,
      "CUSTOMER_SESSION_REQUIRED",
      "Sign in to continue",
    );
  if (!metadata.startsWith("v1:")) return openSession(metadata); // Small legacy cookie.
  const match = /^v1:([1-4])$/.exec(metadata);
  if (!match)
    throw new BffError(
      401,
      "CUSTOMER_SESSION_REQUIRED",
      "Sign in again to continue",
    );
  const count = Number(match[1]);
  const chunks = Array.from({ length: count }, (_, i) =>
    get(`${cookieName}.${i}`),
  );
  if (
    chunks.some(
      (value, i) =>
        !value ||
        value.length > chunkSize ||
        (i < count - 1 && value.length !== chunkSize),
    )
  )
    throw new BffError(
      401,
      "CUSTOMER_SESSION_REQUIRED",
      "Sign in again to continue",
    );
  return openSession(chunks.join(""));
}
export async function requireSession(): Promise<CustomerSession> {
  const jar = await cookies();
  try {
    return readSessionCookies((name) => jar.get(name)?.value);
  } catch (error) {
    // Expired/tampered sessions remove every bounded chunk, not just metadata.
    if (SESSION_COOKIE_NAMES.some((name) => jar.get(name)?.value))
      for (const name of SESSION_COOKIE_NAMES)
        jar.set(name, "", { ...cookieOptions(), maxAge: 0 });
    throw error;
  }
}
export function assertOrigin(request: NextRequest): void {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    throw new BffError(
      403,
      "CSRF_INVALID",
      "A same-origin customer request is required",
    );
}
export function setSession(
  response: NextResponse,
  session: CustomerSession,
): void {
  const values = sessionCookieValues(session);
  clearSession(response);
  const maxAge = Math.max(
    0,
    Math.floor((session.expiresAt - Date.now()) / 1000),
  );
  for (const [name, value] of Object.entries(values))
    response.cookies.set(name, value, { ...cookieOptions(), maxAge });
}
export function clearSession(response: NextResponse): void {
  for (const name of SESSION_COOKIE_NAMES)
    response.cookies.set(name, "", { ...cookieOptions(), maxAge: 0 });
}
// Preserve the SDK's bounded remote-JWKS cache instead of constructing a new
// JWKS fetcher for every login. This caches keys, never JWT acceptance.
let identityClient: {configurationHash:string;client:PrivyClient}|undefined;
export async function verifyIdentity(token: string): Promise<string> {
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET)
    throw new BffError(
      503,
      "SETUP_REQUIRED",
      "Sign-in is temporarily unavailable",
    );
  try {
    if(!token || token.length>32768)throw Error('Invalid identity token');
    const configurationHash=createHash('sha256').update(JSON.stringify([process.env.PRIVY_APP_ID,process.env.PRIVY_APP_SECRET])).digest('hex');
    if(identityClient?.configurationHash!==configurationHash)identityClient={configurationHash,client:new PrivyClient({
      appId: process.env.PRIVY_APP_ID,
      appSecret: process.env.PRIVY_APP_SECRET,
      fetch: (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }),
    })};
    const user = await identityClient.client.users().get({ id_token: token });
    if(typeof user.id!=='string'||!user.id.startsWith('did:privy:'))throw Error('Invalid identity');
    return user.id;
  } catch {
    throw new BffError(
      401,
      "INVALID_CUSTOMER_IDENTITY",
      "Your session could not be verified. Please sign in again",
    );
  }
}
export async function grapnel(
  path: string,
  session?: CustomerSession,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<any> {
  const base = process.env.GRAPNEL_API_URL;
  const key = process.env.GRAPNEL_API_KEY;
  if (!base || !key)
    throw new BffError(
      503,
      "SETUP_REQUIRED",
      "The business has not connected its Grapnel API key",
    );
  const url = new URL(base);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new BffError(
      503,
      "SETUP_REQUIRED",
      "Grapnel requires HTTPS outside local development",
    );
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (session) headers["X-Customer-Identity"] = session.identityToken;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey)
    headers["Idempotency-Key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new BffError(
      503,
      "GRAPNEL_UNAVAILABLE",
      "The Grapnel API could not be reached",
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new BffError(
      502,
      "GRAPNEL_INVALID_RESPONSE",
      "The Grapnel API returned an invalid response",
    );
  }
  if (!response.ok)
    throw new BffError(
      response.status,
      body.error?.code ?? "GRAPNEL_ERROR",
      body.error?.message ?? "The request could not be completed",
      body.error?.code==='WALLET_OPERATION_PENDING' && typeof body.error?.details?.operation_id==='string' && /^[0-9a-f-]{36}$/i.test(body.error.details.operation_id) ? {operation_id:body.error.details.operation_id} : undefined,
    );
  return body.data;
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(
    { data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export function failure(error: unknown) {
  const e =
    error instanceof BffError
      ? error
      : new BffError(
          500,
          "REQUEST_FAILED",
          "The request could not be completed",
        );
  return NextResponse.json(
    { error: { code: e.code, message: e.message, ...(e.details?{details:e.details}:{}) } },
    { status: e.status, headers: { "Cache-Control": "no-store" } },
  );
}
export async function requireModule(
  module: string,
  session: CustomerSession,
  execute = false,
) {
  const data = await grapnel("/capabilities", session);
  const capability = data.capabilities.find(
    (c: { module: string }) => c.module === module,
  );
  if (!capability?.enabled)
    throw new BffError(
      403,
      "MODULE_NOT_ENABLED",
      "This module is disabled by the business",
    );
  if (execute && capability.execution_status !== "testnet_verified")
    throw new BffError(
      409,
      "EXECUTION_UNAVAILABLE",
      "This action is unavailable right now",
    );
  return capability;
}
