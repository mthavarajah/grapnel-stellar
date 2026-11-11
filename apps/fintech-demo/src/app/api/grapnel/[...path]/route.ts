import { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertOrigin,
  BffError,
  failure,
  grapnel,
  json,
  requireModule,
  requireSession,
} from "../../../../lib/server";
export const dynamic = "force-dynamic";
const money = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/)
  .max(100);
const tradeClasses = ["crypto_spot", "stocks", "perps", "commodities"];
async function ownOperation(
  id: string,
  session: Awaited<ReturnType<typeof requireSession>>,
  prepared = true,
) {
  if (!z.string().uuid().safeParse(id).success)
    throw new BffError(404, "NOT_FOUND", "Operation not found");
  const op = await grapnel(`/operations/${id}`, prepared ? session : undefined);
  if (
    op.customer_id !== session.customerId ||
    op.wallet_id !== session.walletId
  )
    throw new BffError(404, "NOT_FOUND", "Operation not found");
  return op;
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await params).path;
    if (path.length === 1 && path[0] === "capabilities")
      return json(await grapnel("/capabilities"));
    const s = await requireSession();
    const key = path.join("/");
    if (key === "wallet")
      return json(await grapnel(`/capital/wallets/${s.walletId}`, s));
    if (key === "balances")
      return json(await grapnel(`/capital/wallets/${s.walletId}/balances`, s));
    if (key === "portfolio")
      return json(await grapnel(`/portfolio?customer_id=${s.customerId}`, s));
    if (key === "funding-assets") {
      await requireModule("capital.testnet_funding", s);
      return json(await grapnel("/capital/testnet/funding-assets", s));
    }
    if (key === "markets") {
      const category =
        request.nextUrl.searchParams.get("asset_class") ?? "crypto_spot";
      if (!tradeClasses.includes(category))
        throw new BffError(422, "VALIDATION_ERROR", "Unknown market category");
      await requireModule(
        "trade." + (category === "crypto_spot" ? "spot" : category),
        s,
      );
      return json(await grapnel(`/trade/markets?asset_class=${category}`, s));
    }
    if(key==='market-history'){
      const parsed=z.object({market_id:z.string().min(1).max(200),range:z.enum(['live','1d','1w','1m','1y','all'])}).safeParse({market_id:request.nextUrl.searchParams.get('market_id'),range:request.nextUrl.searchParams.get('range')??'live'});
      if(!parsed.success)throw new BffError(422,'VALIDATION_ERROR','Select a market and time range');
      const {market_id,range}=parsed.data;
      const module=market_id.startsWith('stellar-testnet:noether:')?'trade.perps':market_id.startsWith('stellar-testnet:soroswap:')?'trade.spot':null;
      if(!module)throw new BffError(404,'NOT_FOUND','Market not found');
      await requireModule(module,s);
      return json(await grapnel(`/trade/markets/${encodeURIComponent(market_id)}/history?range=${range}`,s));
    }
    if(key==='usdc-status'){
      await requireModule('capital.wallets',s);
      const response=await grapnel(`/capital/wallets/${s.walletId}/balances`,s);
      const balances=Array.isArray(response)?response:(response.balances??[]);
      const native=balances.find((b:{asset_id:string})=>b.asset_id==='stellar-testnet:native:XLM');
      if(!native?.as_of)throw new BffError(503,'BALANCE_UNAVAILABLE','Current wallet balance could not be verified');
      const usdc=balances.find((b:{asset_id:string})=>b.asset_id==='stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56');
      return json({enabled:!!usdc,wallet_amount:usdc?.wallet_amount??'0.0000000',spendable:usdc?.spendable??'0.0000000',as_of:usdc?.as_of??native.as_of});
    }
    if(key==='earn-balances'){
      await requireModule('capital.lending',s);
      const [wallet,positions,earningsData]=await Promise.all([grapnel(`/capital/wallets/${s.walletId}/balances`,s),grapnel(`/capital/lending/positions?customer_id=${s.customerId}`,s),grapnel(`/capital/lending/earnings?customer_id=${s.customerId}&wallet_id=${s.walletId}`,s).catch(()=>null)]);
      const walletBalances=Array.isArray(wallet)?wallet:(wallet.balances??[]);
      const poolPositions=Array.isArray(positions)?positions:(positions.positions??[]);
      const earnings=Array.isArray(earningsData)?earningsData:(earningsData?.earnings??[]);
      const ids=['stellar-testnet:native:XLM','stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56'];
      const balances=ids.map(asset_id=>{
        const balance=walletBalances.find((b:{asset_id:string})=>b.asset_id===asset_id);
        const position=poolPositions.find((p:{asset_id:string})=>p.asset_id===asset_id);
        if(!position||(!balance&&asset_id===ids[0]))throw new BffError(503,'BALANCE_UNAVAILABLE','Current Earn balance could not be verified');
        const yieldRow=earnings.find((row:{asset_id:string})=>row.asset_id===asset_id);
        return {asset_id,wallet_amount:balance?.wallet_amount??'0.0000000',spendable:balance?.spendable??'0.0000000',in_earn:position.supplied,earned:yieldRow?.earned??null,earned_since:yieldRow?.earned_since??null,as_of:position.as_of,trustline_required:asset_id===ids[1]&&!balance};
      });
      return json({balances,as_of:new Date().toISOString()});
    }
    if (key === "lending-markets") {
      await requireModule("capital.lending", s);
      return json(await grapnel("/capital/lending/markets", s));
    }
    if (key === "operations")
      return json(await grapnel(`/operations?customer_id=${s.customerId}`, s));
    if (path.length === 2 && path[0] === "operations")
      return json(await ownOperation(path[1]!, s));
    throw new BffError(404, "NOT_FOUND", "Endpoint not available");
  } catch (error) {
    return failure(error);
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    assertOrigin(request);
    const s = await requireSession();
    const path = (await params).path;
    const route = path.join("/");
    const raw = await request.json();
    const key = request.headers.get("idempotency-key");
    if (!key || key.length > 200)
      throw new BffError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "A request identifier is required",
      );
    const binding = { customer_id: s.customerId, wallet_id: s.walletId };
    if (route === "fund" || route === "return") {
      // First fund/return creates the chain evidence that promotes this module.
      // Permit only native XLM while Gate 1 and actual treasury inventory pass;
      // do not require the round-trip proof before its own first execution.
      await requireModule("capital.testnet_funding", s);
      const body = z.object({asset_id:z.string().max(200),amount:money}).strict().parse(raw);
      const capabilitySet = await grapnel("/capabilities", s);
      const walletCapability = capabilitySet.capabilities?.find((c: {module:string}) => c.module === "capital.wallets");
      if (walletCapability?.execution_status !== "testnet_verified")
        throw new BffError(409, "EXECUTION_UNAVAILABLE", "Complete the customer wallet signing check first");
      const fundingAssets = await grapnel("/capital/testnet/funding-assets", s);
      if (!fundingAssets.some((a: {asset_id:string;available:boolean}) => a.asset_id === "stellar-testnet:native:XLM" && a.available === true))
        throw new BffError(409, "EXECUTION_UNAVAILABLE", "Testnet treasury XLM is unavailable");
      return json(
        await grapnel(`/capital/testnet/${route}`, s, {
          method: "POST",
          body: { ...body, ...binding },
          idempotencyKey: key,
        }),
        202,
      );
    }
    if(route==='usdc-trustline'){
      await requireModule('capital.wallets',s,true);
      const body=z.object({limit:z.literal('1000')}).strict().parse(raw);
      return json(await grapnel(`/capital/wallets/${s.walletId}/usdc-trustline`,s,{method:'POST',body:{...body,customer_id:s.customerId},idempotencyKey:key}),202);
    }
    if (route === "test-payment") {
      await requireModule("capital.wallets", s);
      const body = z.object({ amount: money }).strict().parse(raw);
      return json(
        await grapnel(`/capital/wallets/${s.walletId}/test-payment`, s, {
          method: "POST",
          body: { customer_id: s.customerId, amount: body.amount },
          idempotencyKey: key,
        }),
        202,
      );
    }
    if (route === "quote") {
      await requireModule("trade.spot", s);
      await requireModule("capital.wallets", s, true);
      const body = z
        .object({
          market_id: z.string(),
          asset_id: z.string(),
          amount: money,
          slippage_bps: z.number().int().min(0).max(500),
        })
        .strict()
        .parse(raw);
      return json(
        await grapnel("/trade/quotes", s, {
          method: "POST",
          body: {
            customer_id: s.customerId,
            market_id: body.market_id,
            exact_in: { asset_id: body.asset_id, amount: body.amount },
            slippage_bps: body.slippage_bps,
          },
          idempotencyKey: key,
        }),
      );
    }
    if (route === "order") {
      await requireModule("trade.spot", s);
      await requireModule("capital.wallets", s, true);
      const body = z
        .object({ quote_id: z.string().uuid() })
        .strict()
        .parse(raw);
      return json(
        await grapnel("/trade/orders", s, {
          method: "POST",
          body: { ...body, ...binding },
          idempotencyKey: key,
        }),
        202,
      );
    }
    if (
      path.length === 2 &&
      path[0] === "lending" &&
      ["supply", "withdraw", "borrow", "repay"].includes(path[1]!)
    ) {
      const body = z
        .object({ market_id: z.string(), asset_id: z.string(), amount: money })
        .strict()
        .parse(raw);
      if (path[1] === "supply" || path[1] === "withdraw") {
        // Allow a customer-specific Blend preflight before module-level proof
        // exists. The API must validate actual position/liquidity and perform a
        // fresh exact-asset simulation before exposing a signable operation.
        await requireModule("capital.lending", s);
        await requireModule("capital.wallets", s, true);
        if (!["stellar-testnet:native:XLM", "stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"].includes(body.asset_id))
          throw new BffError(
            422,
            "ASSET_MISMATCH",
            "Select the supported XLM or USDC reserve",
          );
      } else {
        await requireModule("capital.lending", s, true);
      }
      return json(
        await grapnel(`/capital/lending/${path[1]}`, s, {
          method: "POST",
          body: { ...body, ...binding },
          idempotencyKey: key,
        }),
        202,
      );
    }
    if (
      path.length === 3 &&
      path[0] === "operations" &&
      path[2] === "authorize"
    ) {
      await ownOperation(path[1]!, s, false);
      const body = z
        .object({
          customer_action_token: z.string().min(1),
          signed_xdr: z.string().min(1).max(150000),
        })
        .strict()
        .parse(raw);
      return json(
        await grapnel(`/operations/${path[1]}/authorize`, s, {
          method: "POST",
          body: { ...body, privy_identity_proof: s.identityToken },
          idempotencyKey: key,
        }),
        202,
      );
    }
    throw new BffError(404, "NOT_FOUND", "Endpoint not available");
  } catch (error) {
    if (error instanceof z.ZodError)
      return failure(
        new BffError(422, "VALIDATION_ERROR", "Invalid request fields"),
      );
    return failure(error);
  }
}
