import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import * as server from "../../../../lib/server.js";
import { GET, POST } from "./route.js";
const session = {
  userId: "did:privy:fixture",
  customerId: "00000000-0000-4000-8000-000000000001",
  walletId: "00000000-0000-4000-8000-000000000002",
  address: "public-fixture-only",
  identityToken: "identity-fixture-never-sent-to-provider",
  expiresAt: Date.now() + 60000,
};
const operationId = "00000000-0000-4000-8000-000000000003";
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const request = (
  path: string,
  body?: unknown,
  origin = "http://localhost:3002",
) =>
  new NextRequest(`http://localhost:3002/api/grapnel/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            origin,
            "content-type": "application/json",
            "idempotency-key": "offline-test-request",
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
beforeEach(() => {
  vi.spyOn(server, "requireSession").mockResolvedValue(session);
  vi.spyOn(server, "requireModule").mockResolvedValue({
    enabled: true,
    execution_status: "testnet_verified",
  });
});
afterEach(() => vi.restoreAllMocks());
describe("sample fintech BFF customer boundaries (offline fixtures)", () => {
  it("does not expose protocol positions in the consumer sample fintech", async () => {
    const upstream = vi.spyOn(server, "grapnel");
    const response = await GET(
      request("lending-positions"),
      context(["lending-positions"]),
    );
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("derives funding customer/wallet from verified session", async () => {
    const upstream = vi.spyOn(server, "grapnel")
      .mockResolvedValueOnce({capabilities:[{module:"capital.wallets",execution_status:"testnet_verified"}]})
      .mockResolvedValueOnce([{asset_id:"stellar-testnet:native:XLM",available:true}])
      .mockResolvedValueOnce({ operation_id: operationId, status: "accepted" });
    const response = await POST(
      request("fund", { asset_id: "stellar-testnet:native:XLM", amount: "1" }),
      context(["fund"]),
    );
    expect(response.status).toBe(202);
    expect(upstream).toHaveBeenCalledWith("/capital/testnet/fund", session, {
      method: "POST",
      body: {
        customer_id: session.customerId,
        wallet_id: session.walletId,
        asset_id: "stellar-testnet:native:XLM",
        amount: "1",
      },
      idempotencyKey: "offline-test-request",
    });
  });
  it("rejects caller-supplied customer/wallet overrides", async () => {
    const upstream = vi.spyOn(server, "grapnel");
    const response = await POST(
      request("fund", {
        asset_id: "stellar-testnet:native:XLM",
        amount: "1",
        customer_id: "someone-else",
        wallet_id: "someone-else",
      }),
      context(["fund"]),
    );
    expect(response.status).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects foreign-customer operations without exposing their data", async () => {
    vi.spyOn(server, "grapnel").mockResolvedValue({
      customer_id: "foreign",
      wallet_id: "foreign",
      secret: "never-return-this",
    });
    const response = await GET(
      request("operations/" + operationId),
      context(["operations", operationId]),
    );
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain(
      "never-return-this",
    );
  });
  it("does not mint a replacement action token during authorization ownership check", async () => {
    const upstream = vi
      .spyOn(server, "grapnel")
      .mockResolvedValueOnce({
        customer_id: session.customerId,
        wallet_id: session.walletId,
      })
      .mockResolvedValueOnce({
        operation_id: operationId,
        status: "preparing",
      });
    const response = await POST(
      request(`operations/${operationId}/authorize`, {
        customer_action_token: "approved-token-fixture",
        signed_xdr: "signed-envelope-fixture",
      }),
      context(["operations", operationId, "authorize"]),
    );
    expect(response.status).toBe(202);
    expect(upstream.mock.calls[0]).toEqual([
      `/operations/${operationId}`,
      undefined,
    ]);
    expect(upstream.mock.calls[1]).toEqual([
      `/operations/${operationId}/authorize`,
      session,
      {
        method: "POST",
        body: {
          customer_action_token: "approved-token-fixture",
          signed_xdr: "signed-envelope-fixture",
          privy_identity_proof: session.identityToken,
        },
        idempotencyKey: "offline-test-request",
      },
    ]);
  });
  it("requires same Origin before reading a customer session", async () => {
    const response = await POST(
      request(
        "fund",
        { asset_id: "stellar-testnet:native:XLM", amount: "1" },
        "https://hostile.example",
      ),
      context(["fund"]),
    );
    expect(response.status).toBe(403);
    expect(server.requireSession).not.toHaveBeenCalled();
  });
  it("keeps arbitrary upstream endpoints outside the BFF allowlist", async () => {
    const upstream = vi.spyOn(server, "grapnel");
    const response = await GET(
      request("dashboard/api-keys"),
      context(["dashboard", "api-keys"]),
    );
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});

it('binds Testnet USDC trustline preparation to the verified customer wallet',async()=>{
 const upstream=vi.spyOn(server,'grapnel').mockResolvedValue({operation_id:operationId,status:'awaiting_customer_authorization'});
 const response=await POST(request('usdc-trustline',{limit:'1000'}),context(['usdc-trustline']));
 expect(response.status).toBe(202);
 expect(upstream).toHaveBeenCalledWith(`/capital/wallets/${session.walletId}/usdc-trustline`,session,{method:'POST',body:{limit:'1000',customer_id:session.customerId},idempotencyKey:'offline-test-request'});
});
it('returns only safe Earn summaries from actual wallet and protocol observations',async()=>{
 const usdc='stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
 vi.spyOn(server,'grapnel').mockResolvedValueOnce([{asset_id:'stellar-testnet:native:XLM',wallet_amount:'10.0000000',spendable:'8.0000000',as_of:new Date().toISOString()}]).mockResolvedValueOnce([{asset_id:'stellar-testnet:native:XLM',supplied:'0.0502446',as_of:new Date().toISOString()},{asset_id:usdc,supplied:'0.0000000',as_of:new Date().toISOString()}]);
 const response=await GET(request('earn-balances'),context(['earn-balances']));const body=await response.json();
 expect(response.status).toBe(200);expect(body.data.balances[0].in_earn).toBe('0.0502446');expect(body.data.balances[1]).toMatchObject({wallet_amount:'0.0000000',trustline_required:true});expect(JSON.stringify(body)).not.toContain('pool_contract_id');
});

// These negative fixtures must stop at the BFF boundary; no provider call occurs.
it.each(['quote','order'])('blocks %s when the business disables spot',async route=>{
 vi.mocked(server.requireModule).mockRejectedValueOnce(new server.BffError(403,'MODULE_NOT_ENABLED','This module is disabled'));
 const upstream=vi.spyOn(server,'grapnel');
 const body=route==='quote'?{market_id:'exact-market',asset_id:'stellar-testnet:native:XLM',amount:'1',slippage_bps:50}:{quote_id:operationId};
 const response=await POST(request(route,body),context([route]));
 expect(response.status).toBe(403);expect(upstream).not.toHaveBeenCalled();
});
it.each(['quote','order'])('blocks %s before a verified wallet signing gate',async route=>{
 vi.mocked(server.requireModule).mockResolvedValueOnce({enabled:true,execution_status:'discovery_only'}).mockRejectedValueOnce(new server.BffError(409,'EXECUTION_UNAVAILABLE','Wallet signing proof is required'));
 const upstream=vi.spyOn(server,'grapnel');
 const body=route==='quote'?{market_id:'exact-market',asset_id:'stellar-testnet:native:XLM',amount:'1',slippage_bps:50}:{quote_id:operationId};
 const response=await POST(request(route,body),context([route]));
 expect(response.status).toBe(409);expect(upstream).not.toHaveBeenCalled();
});
it.each(['stocks','perps','commodities'])('enforces disabled %s read entitlement',async assetClass=>{
 vi.mocked(server.requireModule).mockRejectedValueOnce(new server.BffError(403,'MODULE_NOT_ENABLED','This module is disabled'));
 const upstream=vi.spyOn(server,'grapnel');
 const response=await GET(request('markets?asset_class='+assetClass),context(['markets']));
 expect(response.status).toBe(403);expect(server.requireModule).toHaveBeenCalledWith('trade.'+assetClass,session);expect(upstream).not.toHaveBeenCalled();
});
it.each(['fund','return'])('requires an idempotency key for %s from unified funds controls',async route=>{
 const upstream=vi.spyOn(server,'grapnel');
 const response=await POST(new NextRequest('http://localhost:3002/api/grapnel/'+route,{method:'POST',headers:{origin:'http://localhost:3002','content-type':'application/json'},body:JSON.stringify({asset_id:'stellar-testnet:native:XLM',amount:'0.1'})}),context([route]));
 expect(response.status).toBe(400);expect((await response.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');expect(upstream).not.toHaveBeenCalled();
});
