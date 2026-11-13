import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BalanceTable, PositionTable } from "./customers";
const visibleText = (html: string) => html.replace(/<[^>]*>/g, "");
describe("customer holdings display", () => {
  it("uses six significant digits without floating-point amount conversion", () => {
    const html = renderToStaticMarkup(
      createElement(BalanceTable, {
        balances: [
          {
            asset_id: "stellar-testnet:native:XLM",
            wallet_amount: "12345.6789000",
            reserved: "0.000123456789",
            spendable: "12345.678776543211",
            as_of: "2026-11-11T12:00:00Z",
            source: "stellar_horizon_testnet",
          },
        ],
      }),
    );
    expect(visibleText(html)).toContain("12,345.6");
    expect(visibleText(html)).toContain("0.000123456");
    expect(visibleText(html)).not.toContain("12345.6789000");
    expect(visibleText(html)).toContain("Wallet balanceReservedSpendable");
    expect(visibleText(html)).not.toContain("stellar-testnet:native:XLM");
  });
  it("shows protocol supplies and collateral separately without opaque identifiers", () => {
    const marketId = "stellar-testnet:blend:opaque-market-contract";
    const html = renderToStaticMarkup(
      createElement(PositionTable, {
        positions: [
          {
            market_id: marketId,
            asset_id: "stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
            asset: { code: "USDC" },
            supplied: "20.1234567",
            collateral: "10.0000000",
            borrowed: "0.0000000",
          },
        ],
      }),
    );
    expect(visibleText(html)).toContain(
      "Total suppliedOf which collateralBorrowed",
    );
    expect(visibleText(html)).toContain("20.1234");
    expect(visibleText(html)).toContain("USDC");
    expect(html).not.toContain(marketId);
    expect(html).not.toContain("opaque-reserve");
  });
  it("limits lending rows to Velocity's exact XLM and USDC assets", () => {
    const position = { supplied: "1", collateral: "0", borrowed: "0" };
    const html = renderToStaticMarkup(createElement(PositionTable, { positions: [
      { ...position, market_id: "xlm", asset_id: "stellar-testnet:native:XLM", asset: { code: "XLM" } },
      { ...position, market_id: "other", asset_id: "stellar-testnet:soroban:other", asset: { code: "OTHER" } },
      { ...position, market_id: "wrong-usdc", asset_id: "stellar-testnet:soroban:wrong-usdc", asset: { code: "USDC" } },
    ] }));
    expect(visibleText(html)).toContain("XLM");
    expect(visibleText(html)).not.toContain("OTHER");
    expect(visibleText(html)).not.toContain("USDC");
  });
  it("renders unknown observations as unavailable rather than a zero balance", () => {
    const html = renderToStaticMarkup(
      createElement(BalanceTable, {
        balances: [
          {
            asset_id: "unverified-asset",
            wallet_amount: "not-observed",
            reserved: "0",
            spendable: "not-observed",
            as_of: "",
            source: "unavailable",
          },
        ],
      }),
    );
    expect(visibleText(html).match(/Unavailable/g)).toHaveLength(2);
    expect(visibleText(html)).toContain("Testnet asset");
    expect(visibleText(html)).not.toContain("unverified-asset");
  });
});
