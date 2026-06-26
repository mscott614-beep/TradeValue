import { parsePriceString, type ValuationResult } from "./pricing-extract";

export type AgentValuationPayload = {
  final_price?: unknown;
  currentMarketValue?: unknown;
  method?: string;
  valuation_method?: string;
  active_listings?: unknown[];
  sold_listings?: unknown[];
  marketPrices?: {
    activeItems?: unknown[];
    soldItems?: unknown[];
  };
};

export type AgentValuationResult = ValuationResult & {
  activeListings: unknown[];
  soldListings: unknown[];
};

/**
 * Trust Python /value-card output. The agent already runs resolve_valuation_from_listings.
 * Functions must not re-apply TS pricing math on successful agent responses.
 */
export function valuationFromAgent(
  agentData: AgentValuationPayload,
  logPrefix = "AgentValuation"
): AgentValuationResult {
  const rawPrice = agentData.final_price ?? agentData.currentMarketValue;
  const parsed = parsePriceString(rawPrice);
  const price =
    parsed && parsed > 0.01
      ? parseFloat(parsed.toFixed(2))
      : 0.00;

  const method = String(
    agentData.method || agentData.valuation_method || "agent_valuation"
  );

  const activeListings =
    agentData.active_listings ?? agentData.marketPrices?.activeItems ?? [];
  const soldListings =
    agentData.sold_listings ?? agentData.marketPrices?.soldItems ?? [];

  console.log(
    `[${logPrefix}] Using agent authority: price=${price} method=${method} ` +
      `active=${activeListings.length} sold=${soldListings.length}`
  );

  return {
    price,
    method,
    activeListings,
    soldListings,
  };
}
