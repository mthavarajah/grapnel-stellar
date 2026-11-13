export type ModuleCapability = {
  module: string;
  name: string;
  provider: string;
  description: string;
  enabled: boolean;
  execution_status: string;
  reason: string | null;
  actions: string[];
};
const reasons: Record<string, string> = {
  STOCKS_ROUTE_USES_MAINNET_ASSETS: "The provider's listed stock assets are on mainnet. A verified Testnet route is required.",
  MAINNET_ONLY: "The provider's listed assets are on mainnet. A verified Testnet route is required.",
  MAINNET_ONLY_OR_UNVERIFIED: "A verified Testnet route has not been established.",
  STOCKS_NETWORK_UNVERIFIED: "The stock provider's network has not been verified as Testnet.",
  TESTNET_STOCK_SOLVER_LIQUIDITY_AND_SIGNING_UNVERIFIED: "Testnet stock liquidity and customer signing still need verification.",
  STOCKS_DISCOVERY_UNAVAILABLE: "Stock provider data is temporarily unavailable. Execution remains blocked.",
  SODAX_DISCOVERY_ACCESS_REQUIRED: "Provider access is required to check stock availability.",
  REGION_RESTRICTED: "Trading is unavailable in this jurisdiction under the provider's restrictions.",
  NOT_IN_BETA: "Trading requires admission to the provider's beta.",
  MAINNET_ASSET_NOT_TESTNET: "The listed asset is on mainnet and cannot be used for this Testnet demo.",
  ASSET_LIST_NETWORK_UNVERIFIED: "The asset list's network has not been verified as Testnet.",
};
export function readinessReason(reason: string | null): string | null {
  if (!reason) return null;
  return reasons[reason] ?? (/^[A-Z][A-Z0-9_]+$/.test(reason)
    ? "Provider verification is still required before execution is available."
    : reason);
}
export function ModuleAvailability({ capability, selected }: { capability: ModuleCapability; selected: boolean }) {
  const reason = readinessReason(capability.reason);
  const changed = capability.enabled !== selected;
  return <div className="module-availability">
    <dl>
      <div><dt>Business access</dt><dd className={capability.enabled ? "access-enabled" : "access-disabled"}>{capability.enabled ? "Enabled" : "Disabled"}</dd></div>
    </dl>
    {changed && <p className="module-pending">{selected ? "Access will be enabled on save." : "Access will be disabled on save."}</p>}
    {reason && <div className="module-reason"><p>{reason}</p>{/^[A-Z][A-Z0-9_]+$/.test(capability.reason ?? "") && <details><summary>API reason</summary><code>{capability.reason}</code></details>}</div>}
  </div>;
}
