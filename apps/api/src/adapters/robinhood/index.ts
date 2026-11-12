import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { RH_TESTNET, STOCKS, type StockSymbol } from './registry.js';
export { RH_TESTNET, STOCKS } from './registry.js';

const ABI = parseAbi([
  'function factory() view returns(address)', 'function WETH9() view returns(address)',
  'function token0() view returns(address)', 'function token1() view returns(address)',
  'function fee() view returns(uint24)', 'function decimals() view returns(uint8)',
  'function implementation() view returns(address)', 'function uiMultiplier() view returns(uint256)',
  'function getPool(address,address,uint24) view returns(address)',
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);
const MAX_BYTES = 131072;
export type ReadMethod = 'eth_chainId' | 'eth_blockNumber' | 'eth_getCode' | 'eth_call';
export type RpcRequest = (method: ReadMethod, params: readonly unknown[]) => Promise<unknown>;
export class RobinhoodReadError extends Error { readonly code = 'EXECUTION_UNAVAILABLE'; }
function fail(message: string): never { throw new RobinhoodReadError(message); }
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
function hex(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/.test(value)) fail('Invalid RPC hex response');
  return value as Hex;
}
const fetchRpc: RpcRequest = async (method, params) => {
  const response = await fetch(RH_TESTNET.rpc, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) fail(`Robinhood Testnet RPC HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) fail('RPC response too large');
  const reader = response.body?.getReader(); if (!reader) fail('Missing RPC body');
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); fail('RPC response too large'); }
    parts.push(part.value);
  }
  let payload: { result?: unknown; error?: unknown; id?: unknown; jsonrpc?: unknown };
  try { payload = JSON.parse(Buffer.concat(parts).toString('utf8')) as typeof payload; }
  catch { return fail('Malformed RPC response'); }
  if (payload.jsonrpc !== '2.0' || payload.id !== 1 || payload.error || !('result' in payload)) fail('RPC rejected read');
  return payload.result;
};
export type RobinhoodQuoteInput = { symbol: StockSymbol; side: 'buy' | 'sell'; amountInBaseUnits: string; slippageBps: number };

/** Internal dependency injection supports offline verification; endpoint is never caller-configurable. */
export function createRobinhoodReader(options: { rpcRequest?: RpcRequest; now?: () => number } = {}) {
  const rpc = options.rpcRequest ?? fetchRpc;
  const now = options.now ?? Date.now;
  async function call(address: string, functionName: string, args: readonly unknown[], block: Hex): Promise<unknown> {
    const data = encodeFunctionData({ abi: ABI, functionName: functionName as never, args: args as never });
    return decodeFunctionResult({ abi: ABI, functionName: functionName as never, data: hex(await rpc('eth_call', [{ to: address, data }, block])) });
  }
  async function code(address: string, expected: string, block: Hex) {
    const value = hex(await rpc('eth_getCode', [address, block]));
    if (value === '0x' || keccak256(value) !== expected) fail('Contract runtime differs from verified Testnet registry');
  }
  async function verifyDeployment() {
    if (await rpc('eth_chainId', []) !== '0xb626') fail('Robinhood Testnet chain mismatch');
    const blockValue = await rpc('eth_blockNumber', []);
    if (typeof blockValue !== 'string' || !/^0x[0-9a-fA-F]+$/.test(blockValue)) fail('Invalid block number');
    const block = blockValue as Hex;
    for (const name of ['factory', 'quoter', 'swapRouter02'] as const) await code(RH_TESTNET[name], RH_TESTNET.codeHashes[name], block);
    for (const address of [RH_TESTNET.quoter, RH_TESTNET.swapRouter02]) {
      if (!same(await call(address, 'factory', [], block), RH_TESTNET.factory) || !same(await call(address, 'WETH9', [], block), RH_TESTNET.wrappedNative)) fail('Venue factory or wrapped-native mismatch');
    }
    return { chainId: RH_TESTNET.chainId, blockNumber: BigInt(block).toString(), blockTag: block, executionStatus: 'discovery_only' as const };
  }
  return {
    listMarkets: () => STOCKS,
    verifyDeployment,
    async readStockMultiplier(symbol: StockSymbol) {
      const started = now();
      const market = STOCKS.find(x => x.symbol === symbol); if (!market) fail('Unsupported stock market');
      const deployment = await verifyDeployment();
      await code(market.address, market.codeHash, deployment.blockTag);
      if (!same(await call(RH_TESTNET.beacon, 'implementation', [], deployment.blockTag), RH_TESTNET.implementation)) fail('Stock implementation changed');
      const value = await call(market.address, 'uiMultiplier', [], deployment.blockTag);
      if (typeof value !== 'bigint' || value <= 0n) fail('Invalid stock multiplier');
      if (now() - started > 30000) fail('Multiplier observation expired');
      return { chainId: RH_TESTNET.chainId, tokenAddress: market.address, symbol, multiplierBaseUnits: value.toString(), multiplierDecimals: 18 as const, blockNumber: deployment.blockNumber, observedAt: new Date(started).toISOString() };
    },
    async quoteExactInput(input: RobinhoodQuoteInput) {
      const started = now();
      const market = STOCKS.find(x => x.symbol === input.symbol);
      if (!market || !['buy', 'sell'].includes(input.side)) fail('Unsupported stock market or side');
      if (!/^[1-9][0-9]{0,77}$/.test(input.amountInBaseUnits)) fail('Amount must be a positive integer in exact base units');
      const amountIn = BigInt(input.amountInBaseUnits);
      if (amountIn >= 2n ** 256n) fail('Amount exceeds uint256');
      if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 1000) fail('Slippage must be between 0 and 1000 basis points');
      const deployment = await verifyDeployment(); const block = deployment.blockTag;
      await code(RH_TESTNET.settlement.address, RH_TESTNET.settlement.codeHash, block);
      await code(market.address, market.codeHash, block);
      if (await call(RH_TESTNET.settlement.address, 'decimals', [], block) !== 6 || await call(market.address, 'decimals', [], block) !== 18) fail('Asset decimals mismatch');
      if (!same(await call(RH_TESTNET.beacon, 'implementation', [], block), RH_TESTNET.implementation) || await call(market.address, 'uiMultiplier', [], block) !== 10n ** 18n) fail('Stock implementation or multiplier changed');
      const pool = await call(RH_TESTNET.factory, 'getPool', [market.address as Address, RH_TESTNET.settlement.address as Address, market.fee], block);
      if (!same(pool, market.poolAddress)) fail('Pool differs from verified registry');
      const t0 = await call(market.poolAddress, 'token0', [], block); const t1 = await call(market.poolAddress, 'token1', [], block);
      if (!(same(t0, market.address) && same(t1, RH_TESTNET.settlement.address) || same(t1, market.address) && same(t0, RH_TESTNET.settlement.address)) || await call(market.poolAddress, 'fee', [], block) !== market.fee) fail('Pool token identity or fee mismatch');
      const tokenIn = input.side === 'buy' ? RH_TESTNET.settlement.address : market.address;
      const tokenOut = input.side === 'buy' ? market.address : RH_TESTNET.settlement.address;
      const quoted = await call(RH_TESTNET.quoter, 'quoteExactInputSingle', [{ tokenIn, tokenOut, amountIn, fee: market.fee, sqrtPriceLimitX96: 0n }], block) as readonly [bigint, bigint, number, bigint];
      if (quoted[0] <= 0n) fail('No positive quote available');
      if (now() - started > 30000) fail('Quote expired during verification');
      const observedAt = new Date(started).toISOString();
      return { chainId: RH_TESTNET.chainId, blockNumber: deployment.blockNumber, symbol: market.symbol, side: input.side, pool: market.poolAddress, tokenIn, tokenOut,
        amountInBaseUnits: amountIn.toString(), amountOutBaseUnits: quoted[0].toString(), minimumOutBaseUnits: (quoted[0] * (10000n - BigInt(input.slippageBps)) / 10000n).toString(),
        gasEstimate: quoted[3].toString(), observedAt, expiresAt: new Date(started + 30000).toISOString(), price_basis: 'testnet_pool_quote' as const, executionStatus: 'discovery_only' as const };
    },
  };
}
