import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "./route";
const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("owner proxy security boundary", () => {
  it("rejects cross-origin mutations before contacting Grapnel", async () => {
    vi.stubEnv("DASHBOARD_ORIGIN", "https://console.example");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      new NextRequest("https://console.example/api/grapnel/dashboard/login", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
        body: '{"secret":"x"}',
      }),
      context("dashboard", "login"),
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not proxy business or arbitrary provider routes", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(
      new NextRequest("https://console.example/api/grapnel/customers"),
      context("customers"),
    );
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("forwards only owner session and CSRF; empty DELETE has no JSON content type", async () => {
    vi.stubEnv("DASHBOARD_ORIGIN", "https://console.example");
    vi.stubEnv("GRAPNEL_API_URL", "https://api.example");
    const fetcher = vi.fn().mockResolvedValue(
      new Response('{"data":{"status":"revoked"}}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const id = "00000000-0000-4000-8000-000000000001";
    const request = new NextRequest(
      "https://console.example/api/grapnel/dashboard/api-keys/" + id,
      {
        method: "DELETE",
        headers: {
          Origin: "https://console.example",
          Cookie: "grapnel_owner=session",
          "X-CSRF-Token": "csrf",
          Authorization: "Bearer must-not-forward",
        },
      },
    );
    const response = await DELETE(
      request,
      context("dashboard", "api-keys", id),
    );
    expect(response.status).toBe(200);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.example/v1/dashboard/api-keys/" + id);
    expect(options.headers).toEqual({
      Origin: "https://console.example",
      Cookie: "grapnel_owner=session",
      "X-CSRF-Token": "csrf",
    });
  });
  it("returns an honest unavailable error on upstream failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret underlying error")),
    );
    const response = await GET(
      new NextRequest("https://console.example/api/grapnel/dashboard/session"),
      context("dashboard", "session"),
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("API_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("secret underlying error");
  });
  it.each(["balances", "lending-positions"])(
    "keeps customer %s reads on the owner session boundary",
    async (endpoint) => {
      vi.stubEnv("GRAPNEL_API_URL", "https://api.example");
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response('{"data":{}}', { status: 200 }));
      vi.stubGlobal("fetch", fetcher);
      const id = "00000000-0000-4000-8000-000000000001";
      const response = await GET(
        new NextRequest(
          `https://console.example/api/grapnel/dashboard/customers/${id}/${endpoint}`,
          {
            headers: {
              Cookie:
                "fintech_session=must-not-forward; grapnel_owner=owner-session",
              Authorization: "Bearer must-not-forward",
            },
          },
        ),
        context("dashboard", "customers", id, endpoint),
      );
      expect(response.status).toBe(200);
      expect(fetcher.mock.calls[0][0]).toBe(
        `https://api.example/v1/dashboard/customers/${id}/${endpoint}`,
      );
      expect(fetcher.mock.calls[0][1].headers).toEqual({
        Origin: "https://console.example",
        Cookie: "grapnel_owner=owner-session",
      });
    },
  );
});
