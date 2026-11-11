import { describe, expect, it } from "vitest";
import { normalizePrice, priceChange } from "./service.js";
describe("market price decimal arithmetic", () => {
  it("preserves values beyond Number safe precision", () => {
    expect(normalizePrice("9007199254740993.000000000000000001")).toBe(
      "9007199254740993.000000000000000001",
    );
    expect(
      priceChange(
        "9007199254740993.000000000000000001",
        "9007199254740993.000000000000000002",
      ),
    ).toEqual({
      change_absolute: "0.000000000000000001",
      change_percent: null,
    });
  });
  it("computes signed changes from decimal values without floating point", () => {
    expect(priceChange("10", "11")).toEqual({
      change_absolute: "1",
      change_percent: "10",
    });
    expect(priceChange("3", "2")).toEqual({
      change_absolute: "-1",
      change_percent: "-33.333333333333333333",
    });
    expect(priceChange("4.25", "4.25")).toEqual({
      change_absolute: "0",
      change_percent: "0",
    });
  });
  it("normalizes harmless trailing zeros while preserving the NUMERIC boundary", () => {
    expect(normalizePrice("1.230000000000000000")).toBe("1.23");
    const maximum = "9".repeat(60) + "." + "9".repeat(18);
    expect(normalizePrice(maximum)).toBe(maximum);
  });
  it.each([
    0,
    "0",
    "-1",
    "1e-7",
    ".5",
    "01",
    " 1",
    "1.0000000000000000001",
    "1".repeat(61),
    "NaN",
  ])("rejects invalid or lossy price input %s", (value) =>
    expect(() => normalizePrice(value)).toThrow(),
  );
});
