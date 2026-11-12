import { NextRequest } from "next/server";
import { z } from "zod";
import {MarginWorkflowInputSchema,MarginCustomerBindingSchema,MarginWorkflowPublicSchema,MarginStepQuoteSchema,MarginStepSchema,MarginStepInputSchema,OperationSchema,toAtomic,fromAtomic,XLM,MarginCollateralFundingQuoteSchema,MarginCollateralFundingQuoteInputSchema,MarginCollateralFundingInputSchema} from '@grapnel/contracts';
import {MARGIN_MARKET_ID,MarginBrowserInputSchema,MarginBrowserPrepareSchema,MarginEmptyInputSchema,MarginFundingBrowserQuoteSchema,MarginFundingBrowserPrepareSchema} from '../../../../lib/margin-workflow';
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
async function ownMarginWorkflow(id:string,s:Awaited<ReturnType<typeof requireSession>>){
  if(!z.string().uuid().safeParse(id).success)throw new BffError(404,"NOT_FOUND","Margin setup not found");
  const result=MarginWorkflowPublicSchema.safeParse(await grapnel(`/trade/margin/workflows/${id}?customer_id=${s.customerId}&wallet_id=${s.walletId}`,s));
  if(!result.success)throw new BffError(502,"INVALID_RESPONSE","Margin status is unavailable");
  const row=result.data;
  if(row.workflow_id!==id||row.customer_id!==s.customerId||row.wallet_id!==s.walletId||row.market_id!==MARGIN_MARKET_ID)throw new BffError(404,"NOT_FOUND","Margin setup not found");
  return row;
}
async function marginStepAllowed(id:string,step:string,s:Awaited<ReturnType<typeof requireSession>>){
  await requireModule("trade.perps",s);await requireModule("capital.wallets",s,true);
  const selected=MarginStepSchema.safeParse(step);if(!selected.success)throw new BffError(404,"NOT_FOUND","Margin action not found");
  const workflow=await ownMarginWorkflow(id,s);
  if(!workflow.preparation_available||!workflow.next_steps.includes(selected.data))throw new BffError(409,"EXECUTION_UNAVAILABLE","This margin action is unavailable right now");
  return {workflow,step:selected.data};
}
function publicMarginQuote(value:unknown,id:string,step:string,revision:number){
  const parsed=MarginStepQuoteSchema.safeParse(value);
  if(!parsed.success||parsed.data.workflow_id!==id||parsed.data.step!==step||parsed.data.revision!==revision)throw new BffError(409,"QUOTE_CHANGED","Margin status changed. Check progress and request a fresh quote");
  if(Date.parse(parsed.data.expires_at)<=Date.now()||Date.parse(parsed.data.expires_at)>Date.now()+120000)throw new BffError(409,"QUOTE_EXPIRED","Request a fresh margin quote");
  return parsed.data;
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
    if(key==="margin/workflows"){
      await requireModule("trade.perps",s);
      const response=await grapnel(`/trade/margin/workflows?customer_id=${s.customerId}&wallet_id=${s.walletId}`,s);
      const parsed=z.object({workflows:z.array(MarginWorkflowPublicSchema).max(20)}).strict().safeParse(response);
      if(!parsed.success)throw new BffError(502,"INVALID_RESPONSE","Margin status is unavailable");
      if(parsed.data.workflows.some(row=>row.customer_id!==s.customerId||row.wallet_id!==s.walletId||row.market_id!==MARGIN_MARKET_ID))throw new BffError(404,"NOT_FOUND","Margin setup not found");
      return json(parsed.data);
    }
    if(path.length===3&&path[0]==="margin"&&path[1]==="workflows"){
      await requireModule("trade.perps",s);return json(await ownMarginWorkflow(path[2]!,s));
    }
    if(key==="market-overview"){
      await requireModule("capital.wallets",s);
      return json(await grapnel("/market-overview",s));
    }
    if(key==="account-valuation"){
      await requireModule("capital.wallets",s);
      return json(await grapnel(`/portfolio/valuation?customer_id=${s.customerId}&wallet_id=${s.walletId}`,s));
    }
    if(key==="wallet-valuation"){
      await requireModule("capital.wallets",s);
      return json(await grapnel(`/capital/wallets/${s.walletId}/valuation?customer_id=${s.customerId}`,s));
    }
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
      const module=(market_id==='stellar-testnet:peridot:XLM-USDT-MARGIN'||market_id.startsWith('stellar-testnet:noether:'))?'trade.perps':market_id.startsWith('stellar-testnet:soroswap:')?'trade.spot':(market_id.startsWith('sodax:catalog:mainnet:')||market_id.startsWith('sodax:catalog:testnet:'))?'trade.stocks':null;
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
    if(key==="borrowing"){
      await requireModule("capital.lending",s);
      return json(await grapnel(`/capital/lending/borrowing?customer_id=${s.customerId}&wallet_id=${s.walletId}`,s));
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
    if(route==="margin/collateral/quote"||route==="margin/collateral/swap"){
      await requireModule("trade.perps",s);await requireModule("capital.wallets",s,true);
      const requestBody=route.endsWith("/quote")?MarginFundingBrowserQuoteSchema.parse(raw):MarginFundingBrowserPrepareSchema.parse(raw);
      const markets=await grapnel("/trade/markets?asset_class=perps",s);
      const selected=(Array.isArray(markets)?markets:markets?.markets??[]).find((entry:{market_id:string})=>entry.market_id===MARGIN_MARKET_ID);
      if(selected?.network!=="stellar-testnet"||selected?.collateral?.network!=="stellar-testnet"||selected?.collateral?.verified!==true||selected?.collateral?.decimals!==7)throw new BffError(409,"EXECUTION_UNAVAILABLE","Collateral funding is unavailable right now");
      const validateQuote=(value:unknown,amount:string)=>{
        const parsed=MarginCollateralFundingQuoteSchema.safeParse(value);
        if(!parsed.success||parsed.data.from_asset_id!==XLM.id||parsed.data.to_asset_id!==selected.collateral.id||BigInt(parsed.data.amount_in_atomic)!==toAtomic(amount,7)||BigInt(parsed.data.minimum_out_atomic)>BigInt(parsed.data.expected_out_atomic))throw new BffError(409,"INTENT_MISMATCH","Collateral quote does not match your request");
        if(Date.parse(parsed.data.expires_at)<=Date.now()||Date.parse(parsed.data.expires_at)>Date.now()+120000)throw new BffError(409,"QUOTE_EXPIRED","Get a fresh collateral quote");
        return parsed.data;
      };
      if("amount" in requestBody){
        const input=MarginCollateralFundingQuoteInputSchema.parse({...binding,amount:requestBody.amount});
        return json(validateQuote(await grapnel("/trade/margin/collateral/quote",s,{method:"POST",body:input,idempotencyKey:key}),input.amount));
      }
      const amount=fromAtomic(BigInt(requestBody.quote.amount_in_atomic),7);
      const input=MarginCollateralFundingInputSchema.parse({...binding,amount,minimum_output_atomic:requestBody.quote.minimum_out_atomic});
      validateQuote(requestBody.quote,amount);
      const op=OperationSchema.safeParse(await grapnel("/trade/margin/collateral/swap",s,{method:"POST",body:input,idempotencyKey:key}));
      if(!op.success||op.data.customer_id!==s.customerId||op.data.wallet_id!==s.walletId||op.data.type!=="margin.collateral_swap"||op.data.module!=="trade.perps"||!z.string().uuid().safeParse(op.data.operation_id).success)throw new BffError(409,"INTENT_MISMATCH","Collateral operation does not match your request");
      return json(op.data,202);
    }
    if(route==="margin/workflows"){
      await requireModule("trade.perps",s,true);await requireModule("capital.wallets",s,true);
      const body=MarginBrowserInputSchema.parse(raw);
      if(body.market_id!==MARGIN_MARKET_ID)throw new BffError(422,"VALIDATION_ERROR","Select the supported margin market");
      const rows=await grapnel("/trade/markets?asset_class=perps",s),market=(Array.isArray(rows)?rows:rows.markets??[]).find((entry:{market_id:string})=>entry.market_id===MARGIN_MARKET_ID);
      if(market?.preparation_available!==true||market?.network!=="stellar-testnet"||market?.instrument_type!=="leveraged_margin")throw new BffError(409,"EXECUTION_UNAVAILABLE","Margin setup is unavailable right now");
      const response=MarginWorkflowPublicSchema.safeParse(await grapnel("/trade/margin/workflows",s,{method:"POST",body:MarginWorkflowInputSchema.parse({...body,...binding}),idempotencyKey:key}));
      if(!response.success)throw new BffError(502,"INVALID_RESPONSE","Margin status is unavailable");
      if(response.data.customer_id!==s.customerId||response.data.wallet_id!==s.walletId||response.data.market_id!==MARGIN_MARKET_ID)throw new BffError(404,"NOT_FOUND","Margin setup not found");
      if(response.data.direction!==body.direction||response.data.leverage!==body.leverage||response.data.amount_atomic!==toAtomic(body.amount,7).toString())throw new BffError(409,"INTENT_MISMATCH","Margin setup does not match your request");
      return json(response.data,202);
    }
    if(path.length===4&&path[0]==="margin"&&path[1]==="workflows"&&path[3]==="reconcile"){
      MarginEmptyInputSchema.parse(raw);await requireModule("trade.perps",s);await ownMarginWorkflow(path[2]!,s);
      await grapnel(`/trade/margin/workflows/${path[2]}/reconcile`,s,{method:"POST",body:MarginCustomerBindingSchema.parse(binding),idempotencyKey:key});
      return json(await ownMarginWorkflow(path[2]!,s));
    }
    if(path.length>=5&&path[0]==="margin"&&path[1]==="workflows"&&path[3]==="steps"){
      if(path.length>6||(path.length===6&&path[5]!=="quote"))throw new BffError(404,"NOT_FOUND","Margin action not found");
      const {workflow,step}=await marginStepAllowed(path[2]!,path[4]!,s);
      if(path.length===6){
        MarginEmptyInputSchema.parse(raw);
        const quote=await grapnel(`/trade/margin/workflows/${workflow.workflow_id}/steps/${step}/quote`,s,{method:"POST",body:MarginCustomerBindingSchema.parse(binding),idempotencyKey:key});
        return json(publicMarginQuote(quote,workflow.workflow_id,step,workflow.revision));
      }
      const submitted=MarginBrowserPrepareSchema.parse(raw);
      publicMarginQuote(submitted.quote,workflow.workflow_id,step,workflow.revision);
      const fresh=publicMarginQuote(await grapnel(`/trade/margin/workflows/${workflow.workflow_id}/steps/${step}/quote`,s,{method:"POST",body:MarginCustomerBindingSchema.parse(binding),idempotencyKey:key}),workflow.workflow_id,step,workflow.revision);
      if(JSON.stringify(fresh.terms)!==JSON.stringify(submitted.quote.terms))throw new BffError(409,"QUOTE_CHANGED","The margin limit changed. Request a fresh quote");
      const operation=await grapnel(`/trade/margin/workflows/${workflow.workflow_id}/steps/${step}`,s,{method:"POST",body:MarginStepInputSchema.parse({...binding,terms:submitted.quote.terms}),idempotencyKey:key});
      const publicOperation=OperationSchema.safeParse(operation);
      if(!publicOperation.success)throw new BffError(502,"INVALID_RESPONSE","Wallet action is unavailable");
      if(publicOperation.data.customer_id!==s.customerId||publicOperation.data.wallet_id!==s.walletId||!z.string().uuid().safeParse(publicOperation.data.operation_id).success)throw new BffError(404,"NOT_FOUND","Wallet action not found");
      return json(publicOperation.data,202);
    }
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
    const borrowingAction=path.length===2&&path[0]==="lending"&&["borrow","repay"].includes(path[1]!)?path[1]:route==="borrow-collateral-supply"?"collateral_supply":route==="borrow-collateral-withdraw"?"collateral_withdraw":null;
    if(borrowingAction){
      await requireModule("capital.lending",s);
      await requireModule("capital.wallets",s,true);
      const body=z.object({market_id:z.string().min(1).max(200),amount:money}).strict().parse(raw);
      const current=await grapnel(`/capital/lending/borrowing?customer_id=${s.customerId}&wallet_id=${s.walletId}`,s);
      const row=(Array.isArray(current?.assets)?current.assets:[]).find((entry:{market_id:string})=>entry.market_id===body.market_id);
      if(!row||row.asset?.network!=="stellar-testnet"||row.asset?.verified!==true||typeof row.asset?.id!=="string"||row[`can_prepare_${borrowingAction}`]!==true)throw new BffError(409,"EXECUTION_UNAVAILABLE","This loan action is unavailable right now. Refresh your loans and try again.");
      const upstreamPath=borrowingAction.startsWith("collateral_")?`/capital/lending/borrowing/collateral/${borrowingAction.slice("collateral_".length)}`:`/capital/lending/${borrowingAction}`;
      return json(await grapnel(upstreamPath,s,{method:"POST",body:{...body,asset_id:row.asset.id,...binding},idempotencyKey:key}),202);
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
