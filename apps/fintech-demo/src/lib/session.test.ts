import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { cookies as readCookies } from "next/headers";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import {
  clearSession,
  grapnel,
  openSession,
  readSessionCookies,
  requireSession,
  sealSession,
  sessionCookieValues,
  setSession,
  SESSION_COOKIE_NAMES,
} from "./server.js";
const fixture = (identityToken = "sensitive-token") => ({
  userId: "did:privy:test",
  customerId: "tenant-customer",
  walletId: "own-wallet",
  address: "fixture",
  identityToken,
  expiresAt: Date.now() + 60000,
});
process.env.FINTECH_SESSION_SECRET =
  "test-session-secret-with-at-least-32-characters";
afterEach(() => vi.unstubAllGlobals());
describe("encrypted bounded customer sessions", () => {
  it("hides identity tokens and binds integrity", () => {
    const session = fixture();
    const sealed = sealSession(session);
    expect(sealed).not.toContain("sensitive-token");
    expect(openSession(sealed)).toEqual(session);
    const tampered = sealed.slice(0, -12) + "AAAAAAAAAAAA";
    expect(() => openSession(tampered)).toThrow("Sign in again");
  });
  it("rejects expired sessions", () => {
    const sealed = sealSession({ ...fixture(), expiresAt: Date.now() - 1000 });
    expect(() => openSession(sealed)).toThrow("Sign in again");
  });
  it("round-trips realistic large identity tokens across individually bounded cookies", () => {
    const session = fixture("a".repeat(5000));
    const values = sessionCookieValues(session);
    expect(Object.keys(values).length).toBeGreaterThan(2);
    expect(Object.values(values).every((value) => value.length <= 3000)).toBe(
      true,
    );
    expect(readSessionCookies((name) => values[name])).toEqual(session);
    const response = NextResponse.json({ ok: true });
    setSession(response, session);
    expect(
      response.cookies
        .getAll()
        .every(
          (cookie) =>
            cookie.value.length < 4096 &&
            cookie.httpOnly &&
            cookie.sameSite === "lax",
        ),
    ).toBe(true);
  });
  it("rejects missing, tampered, reordered or excess chunks", () => {
    const values = sessionCookieValues(fixture("a".repeat(5000)));
    for (const changed of [
      { ...values, "local_finance_session.1": undefined },
      { ...values, "local_finance_session.1": "B".repeat(3000) },
      { ...values, local_finance_session: "v1:9" },
      {
        ...values,
        "local_finance_session.0": values["local_finance_session.1"],
        "local_finance_session.1": values["local_finance_session.0"],
      },
    ])
      expect(() =>
        readSessionCookies(
          (name) => (changed as Record<string, string | undefined>)[name],
        ),
      ).toThrow("Sign in again");
  });
  it("clears every cookie chunk when a stored session expires", async () => {
    const values = sessionCookieValues({
      ...fixture("a".repeat(5000)),
      expiresAt: Date.now() - 1000,
    });
    const set = vi.fn();
    vi.mocked(readCookies).mockResolvedValue({
      get: (name: string) =>
        values[name] ? { value: values[name] } : undefined,
      set,
    } as unknown as Awaited<ReturnType<typeof readCookies>>);
    await expect(requireSession()).rejects.toThrow("Sign in again");
    expect(set).toHaveBeenCalledTimes(SESSION_COOKIE_NAMES.length);
    for (const name of SESSION_COOKIE_NAMES)
      expect(set).toHaveBeenCalledWith(
        name,
        "",
        expect.objectContaining({ httpOnly: true, maxAge: 0 }),
      );
  });
  it("explicitly rejects oversized sessions and clears metadata plus all possible chunks", () => {
    expect(() => sessionCookieValues(fixture("a".repeat(20000)))).toThrow(
      "identity session is too large",
    );
    const response = NextResponse.json({ ok: true });
    setSession(response, fixture("a".repeat(5000)));
    clearSession(response);
    for (const name of SESSION_COOKIE_NAMES)
      expect(response.cookies.get(name)).toMatchObject({
        value: "",
        maxAge: 0,
        httpOnly: true,
      });
  });
});
describe("credential-bearing Grapnel fetch", () => {
  it("never follows redirects while forwarding business/customer credentials", async () => {
    process.env.GRAPNEL_API_URL = "https://api.example";
    process.env.GRAPNEL_API_KEY = "gr_test_offline-fixture";
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", upstream);
    await grapnel("/capabilities", fixture());
    expect(upstream.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: "Bearer gr_test_offline-fixture",
        "X-Customer-Identity": "sensitive-token",
      },
    });
  });
});
