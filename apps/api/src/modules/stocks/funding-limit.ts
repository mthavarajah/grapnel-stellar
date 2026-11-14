export const DEFAULT_STOCK_FUNDING_MAX_WALLETS = 100;

/** A finite lifetime grant budget; each wallet still receives at most one grant. */
export function stockFundingMaxWallets(value: string | number = DEFAULT_STOCK_FUNDING_MAX_WALLETS): bigint {
  const text = String(value);
  if (!/^[1-9]\d{0,4}$/.test(text) || BigInt(text) > 10000n)
    throw new Error('ROBINHOOD_TESTNET_FUNDING_MAX_WALLETS must be an integer between 1 and 10000');
  return BigInt(text);
}
