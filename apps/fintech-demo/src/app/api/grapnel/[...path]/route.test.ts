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
it.each(['mainnet','testnet'])('binds %s stock reference history to the stocks entitlement',async network=>{
 const market=`sodax:catalog:${network}:CAZSFDNSSR2RKJ2LIIB2Y4G4WOSYYKC4646EUJ63PQLDDHOVQYZ4HDTK`;
 const upstream=vi.spyOn(server,'grapnel').mockResolvedValue({market_id:market,points:[]});
 const response=await GET(request(`market-history?market_id=${encodeURIComponent(market)}&range=1y`),context(['market-history']));
 expect(response.status).toBe(200);expect(server.requireModule).toHaveBeenCalledWith('trade.stocks',session);
 expect(upstream).toHaveBeenCalledWith(`/trade/markets/${encodeURIComponent(market)}/history?range=1y`,session);
});
it('requires the verified customer session before reading the overview',async()=>{
 vi.mocked(server.requireSession).mockRejectedValueOnce(new server.BffError(401,'SESSION_REQUIRED','Sign in'));
 const upstream=vi.spyOn(server,'grapnel');
 expect((await GET(request('market-overview'),context(['market-overview']))).status).toBe(401);
 expect(upstream).not.toHaveBeenCalled();
});
it('enforces wallet access before reading the public overview',async()=>{
 vi.mocked(server.requireModule).mockRejectedValueOnce(new server.BffError(403,'MODULE_NOT_ENABLED','Disabled'));
 const upstream=vi.spyOn(server,'grapnel');
 expect((await GET(request('market-overview'),context(['market-overview']))).status).toBe(403);
 expect(server.requireModule).toHaveBeenCalledWith('capital.wallets',session);expect(upstream).not.toHaveBeenCalled();
});
it('binds market history to the matching business module and safely encoded exact market',async()=>{
 const market='stellar-testnet:soroswap:verified-pair:XLM-USDC';
 const upstream=vi.spyOn(server,'grapnel').mockResolvedValue({market_id:market,points:[]});
 const response=await GET(request(`market-history?market_id=${encodeURIComponent(market)}&range=1d`),context(['market-history']));
 expect(response.status).toBe(200);expect(server.requireModule).toHaveBeenCalledWith('trade.spot',session);
 expect(upstream).toHaveBeenCalledWith(`/trade/markets/${encodeURIComponent(market)}/history?range=1d`,session);
});
it('rejects invalid history ranges and disabled perps before reading any provider data',async()=>{
 const upstream=vi.spyOn(server,'grapnel');
 expect((await GET(request('market-history?market_id=stellar-testnet:noether:BTC-PERP&range=made-up'),context(['market-history']))).status).toBe(422);
 expect(upstream).not.toHaveBeenCalled();
 vi.mocked(server.requireModule).mockRejectedValueOnce(new server.BffError(403,'MODULE_NOT_ENABLED','This module is disabled'));
 expect((await GET(request('market-history?market_id=stellar-testnet:noether:BTC-PERP&range=live'),context(['market-history']))).status).toBe(403);
 expect(server.requireModule).toHaveBeenCalledWith('trade.perps',session);expect(upstream).not.toHaveBeenCalled();
});
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

describe('borrowing pool customer boundaries',()=>{
 const asset={id:'stellar-testnet:native:XLM',code:'XLM',network:'stellar-testnet',verified:true};
 const readPath=`/capital/lending/borrowing?customer_id=${session.customerId}&wallet_id=${session.walletId}`;
 it('binds loan reads to the verified customer and wallet',async()=>{
  const upstream=vi.spyOn(server,'grapnel').mockResolvedValue({assets:[]});
  expect((await GET(request('borrowing'),context(['borrowing']))).status).toBe(200);
  expect(server.requireModule).toHaveBeenCalledWith('capital.lending',session);expect(upstream).toHaveBeenCalledWith(readPath,session);
 });
 it.each([['lending/borrow','borrow','/capital/lending/borrow'],['lending/repay','repay','/capital/lending/repay'],['borrow-collateral-supply','collateral_supply','/capital/lending/borrowing/collateral/supply'],['borrow-collateral-withdraw','collateral_withdraw','/capital/lending/borrowing/collateral/withdraw']])('derives exact asset/session for %s',async(route,action,path)=>{
  const upstream=vi.spyOn(server,'grapnel').mockResolvedValueOnce({assets:[{market_id:'new-pool-xlm',asset,[`can_prepare_${action}`]:true}]}).mockResolvedValueOnce({operation_id:operationId,status:'awaiting_customer_authorization'});
  expect((await POST(request(route,{market_id:'new-pool-xlm',amount:'0.1234567'}),context(route.split('/')))).status).toBe(202);
  expect(server.requireModule).toHaveBeenCalledWith('capital.wallets',session,true);
  expect(upstream).toHaveBeenNthCalledWith(1,readPath,session);
  expect(upstream).toHaveBeenNthCalledWith(2,path,session,{method:'POST',body:{market_id:'new-pool-xlm',amount:'0.1234567',asset_id:asset.id,customer_id:session.customerId,wallet_id:session.walletId},idempotencyKey:'offline-test-request'});
 });
 it.each([{asset_id:'caller-asset'},{customer_id:'foreign'},{wallet_id:'foreign'},{pool_id:'old-earn-pool'}])('rejects browser overrides %j',async override=>{
  const upstream=vi.spyOn(server,'grapnel');expect((await POST(request('lending/borrow',{market_id:'new-pool-xlm',amount:'1',...override}),context(['lending','borrow']))).status).toBe(422);expect(upstream).not.toHaveBeenCalled();
 });
 it.each([{assets:[]},{assets:[{market_id:'old-earn-pool',asset,can_prepare_borrow:true}]},{assets:[{market_id:'new-pool-xlm',asset,can_prepare_borrow:false}]},{assets:[{market_id:'new-pool-xlm',asset:{...asset,network:'stellar-mainnet'},can_prepare_borrow:true}]}])('rejects unknown, blocked and wrong-network pool rows',async ({assets})=>{
  const upstream=vi.spyOn(server,'grapnel').mockResolvedValue({assets});expect((await POST(request('lending/borrow',{market_id:'new-pool-xlm',amount:'1'}),context(['lending','borrow']))).status).toBe(409);expect(upstream).toHaveBeenCalledTimes(1);
 });
 it('denies disabled lending before reading pool or sending a write',async()=>{
  vi.mocked(server.requireModule).mockRejectedValueOnce(new server.BffError(403,'MODULE_NOT_ENABLED','Disabled'));const upstream=vi.spyOn(server,'grapnel');expect((await POST(request('lending/borrow',{market_id:'new-pool-xlm',amount:'1'}),context(['lending','borrow']))).status).toBe(403);expect(upstream).not.toHaveBeenCalled();
 });
});
