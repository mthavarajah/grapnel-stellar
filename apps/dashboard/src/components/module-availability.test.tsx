import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModuleAvailability, readinessReason, type ModuleCapability } from "./module-availability";
const capability: ModuleCapability = { module: "trade.stocks", name: "Stocks", provider: "sodax", description: "", enabled: false, execution_status: "blocked", reason: "STOCKS_ROUTE_USES_MAINNET_ASSETS", actions: [] };
const render = (overrides: Partial<ModuleCapability> = {}, selected = false) => renderToStaticMarkup(createElement(ModuleAvailability, { capability: { ...capability, ...overrides }, selected }));
describe("module access and provider readiness", () => {
  it("keeps a pending toggle separate from saved permission and blocked execution", () => {
    const html = render({}, true);
    expect(html).toContain('access-disabled'); expect(html).toContain('Disabled');
    expect(html).toContain('Access will be enabled on save.'); expect(html).toContain('Blocked');
    expect(html).toContain('stock assets are on mainnet'); expect(html).not.toContain('Testnet verified');
  });
  it("does not promote execution when permission is enabled", () => {
    const html = render({ enabled: true }, true);
    expect(html).toContain('access-enabled'); expect(html).toContain('Blocked');
    expect(html).not.toContain('on save'); expect(html).not.toContain('Read-only access');
  });
  it("reports jurisdiction requirements in plain language", () => {
    expect(render({ module: 'trade.perps', reason: 'REGION_RESTRICTED' })).toContain('unavailable in this jurisdiction');
  });
  it("does not infer public read availability from a discovery status", () => {
    expect(render({ execution_status: 'discovery_only' })).not.toContain('Market data');
    expect(render({ actions: ['read_markets'], execution_status: 'discovery_only' })).toContain('Read-only access · module disabled');
  });
  it("preserves verified readiness when access is disabled and awaiting removal", () => {
    const html = render({ enabled: true, execution_status: 'testnet_verified', reason: null }, false);
    expect(html).toContain('Testnet verified'); expect(html).toContain('Access will be disabled on save.');
  });
  it("never labels unknown status or reason as verified", () => {
    expect(render({ execution_status: 'new_status', reason: 'NEW_PROVIDER_BLOCK' })).toContain('Not verified');
    expect(readinessReason('NEW_PROVIDER_BLOCK')).toContain('verification is still required');
    expect(readinessReason('Provider is temporarily unavailable')).toBe('Provider is temporarily unavailable');
    expect(readinessReason(null)).toBeNull();
  });
});
