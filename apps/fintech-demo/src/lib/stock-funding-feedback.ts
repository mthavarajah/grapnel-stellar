const rejections = {
  STOCK_FUNDING_TREASURY_GAS: 'Funding is temporarily paused while transaction fees are replenished. No funds were sent.',
  STOCK_FUNDING_TREASURY_LOW: 'Funding is temporarily paused while funds or transaction fees are replenished. No funds were sent.',
  STOCK_FUNDING_CAP: 'The funding allowance has been reached. No funds were sent.',
  STOCK_FUNDING_TREASURY_PENDING: 'Another funding transfer is being confirmed. Please try again shortly.',
  STOCK_FUNDING_ALREADY_ALLOCATED: 'This trading account has already received its funding allocation.',
} as const;

/** Only these server preflight failures establish that this attempt did not broadcast. */
export function stockFundingRejectionReason(value: unknown): keyof typeof rejections | undefined {
  return typeof value === 'string' && Object.hasOwn(rejections,value) ? value as keyof typeof rejections : undefined;
}

export function stockFundingRejectionMessage(code: string,status: number,reason: unknown): string | null {
  const key=stockFundingRejectionReason(reason);
  return code==='EXECUTION_UNAVAILABLE' && status===409 && key ? rejections[key] : null;
}
