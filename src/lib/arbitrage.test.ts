import { describe, it, expect } from "vitest";
import { scoreArbitrageOpportunity } from "./arbitrage";

describe("scoreArbitrageOpportunity", () => {
  it("flags strong slab-to-raw spread with underpriced listing", () => {
    const result = scoreArbitrageOpportunity({
      rawMedianUsd: 50,
      slabMedianUsd: 1200,
      multiplierExpected: 8,
      bestRawPrice: 45,
      gradingPassRate: "high",
    });
    expect(result.qualifies).toBe(true);
    expect(result.multiplierObserved).toBeGreaterThan(20);
    expect(result.arbitrageScore).toBeGreaterThan(50);
    expect(result.confidence).not.toBe("low");
  });

  it("rejects thin or low-slab spreads", () => {
    const result = scoreArbitrageOpportunity({
      rawMedianUsd: 40,
      slabMedianUsd: 60,
      multiplierExpected: 8,
    });
    expect(result.qualifies).toBe(false);
  });
});
