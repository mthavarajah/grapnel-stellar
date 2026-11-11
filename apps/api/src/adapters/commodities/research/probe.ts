// Read-only Testnet availability probe. Uses only Horizon and Soroswap quote endpoints.
import { Asset } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from '@grapnel/contracts';

const horizon = 'https://horizon-testnet.stellar.org';
const soroswap = 'https://api.soroswap.finance';
const xauClIssuer = 'GBCB4WO6J4ET55RWK2SVX76LUQ4PQ7TCDHG2YFILQML7D6XR3HACLXAU';
const xauClCode = 'XAU';
const xauSac = new Asset(xauClCode, xauClIssuer).contractId(NETWORK_PASSPHRASE);
const xlmSac = Asset.native().contractId(NETWORK_PASSPHRASE);
const commonCommodityCodes = ['WTGOLD', 'GOLD', 'XAU', 'XAG', 'SILVER', 'PAXG', 'XAUM'];

async function json(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, init);
  let body: Record<string, unknown> = {};
  try { body = await response.json() as Record<string, unknown>; } catch { /* report status only */ }
  return { status: response.status, body };
}

async function main(): Promise<void> {
  const [codeLookups, xauIssuer, xauAsset, orderbook] = await Promise.all([
    Promise.all(commonCommodityCodes.map(code => json(`${horizon}/assets?asset_code=${code}&limit=200`))),
    json(`${horizon}/accounts/${xauClIssuer}`),
    json(`${horizon}/assets?asset_code=${xauClCode}&asset_issuer=${xauClIssuer}`),
    json(`${horizon}/order_book?buying_asset_type=credit_alphanum4&buying_asset_code=${xauClCode}&buying_asset_issuer=${xauClIssuer}&selling_asset_type=native&limit=10`),
  ]);
  const records = (value: Record<string, unknown>) => {
    const embedded = value._embedded as { records?: unknown[] } | undefined;
    return Array.isArray(embedded?.records) ? embedded.records : [];
  };
  const bids = Array.isArray(orderbook.body.bids) ? orderbook.body.bids.length : null;
  const asks = Array.isArray(orderbook.body.asks) ? orderbook.body.asks.length : null;
  let soroswapSummary: Record<string, unknown> = { status: 'not_tested_api_key_missing' };
  const apiKey = process.env.SOROSWAP_API_KEY;
  if (apiKey) {
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const protocols = await json(`${soroswap}/protocols?network=testnet`, { headers });
    const quote = await json(`${soroswap}/quote?network=testnet`, {
      method: 'POST', headers, body: JSON.stringify({ assetIn: xlmSac, assetOut: xauSac, amount: '10000000', tradeType: 'EXACT_IN', protocols: ['sdex', 'soroswap'], slippageBps: 49 }),
    });
    soroswapSummary = {
      protocols_status: protocols.status,
      protocols: Array.isArray(protocols.body) ? protocols.body : null,
      quote_status: quote.status,
      quote_error: quote.status >= 400 ? quote.body.error ?? quote.body.code ?? quote.body.errorCode ?? 'provider_error' : null,
      route_count: Array.isArray(quote.body.routePlan) ? quote.body.routePlan.length : null,
    };
  }
  console.log(JSON.stringify({
    observed_at: new Date().toISOString(), network: 'stellar-testnet', mode: 'read_only',
    verified_gold_backed_candidates_in_checked_set: 0,
    checks: {
      testnet_asset_code_collisions: Object.fromEntries(commonCommodityCodes.map((code, index) => [code, {
        status: codeLookups[index]!.status, issuer_count: records(codeLookups[index]!.body).length,
      }])),
      xau_cl: {
        classification: 'excluded_not_backed_by_physical_gold_per_issuer_toml', issuer: xauClIssuer,
        derived_testnet_sac: xauSac, issuer_account_status: xauIssuer.status,
        exact_asset_status: xauAsset.status, exact_asset_count: records(xauAsset.body).length,
        sdex_orderbook_status: orderbook.status, bids, asks,
      },
      soroswap: soroswapSummary,
    },
    signed: false, broadcast: false,
  }));
}

main().catch(() => { console.error('Commodity Testnet probe failed; no write operations were requested.'); process.exitCode = 1; });
