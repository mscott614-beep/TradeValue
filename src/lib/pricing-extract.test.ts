import { describe, it, expect } from "vitest";
import { parsePriceString, resolveValuationFromListings } from "./pricing-extract";

describe("pricing-extract", () => {
  it("parsePriceString rejects none and parses currency", () => {
    expect(parsePriceString("none")).toBeNull();
    expect(parsePriceString("$12.50")).toBe(12.5);
  });

  it("resolveValuationFromListings uses trimmed mean on sold listings", () => {
    const result = resolveValuationFromListings({
      activeListings: [],
      soldListings: [
        { price: 10 },
        { price: 12 },
        { price: 14 },
        { price: 100 },
      ],
      logPrefix: "Test",
    });
    expect(result.price).toBeGreaterThan(10);
    expect(result.price).toBeLessThan(100);
    expect(result.method).toMatch(/trimmed_mean/);
  });
});
