/**
 * AUTO-GENERATED — do not edit.
 * Canonical source: src/lib/pricing-extract.ts
 * Regenerate: node scripts/sync-shared-libs.mjs (runs via functions prebuild)
 */

/**
 * Canonical TS pricing extraction (eBay-only fallback path in Firebase Functions).
 * Live /value-card valuations are computed in agent_service.py — do not re-run this
 * math on successful agent responses.
 * Keep in sync with agent_service.py valuation helpers.
 */

export type ValuationResult = {
  price: number;
  method: string;
};

export function parsePriceString(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number" && !isNaN(val) && val > 0) return val;

  const raw = String(val).trim();
  if (!raw || ["n/a", "null", "undefined", "none"].includes(raw.toLowerCase())) {
    return null;
  }

  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;

  const parsed = parseFloat(cleaned);
  return !isNaN(parsed) && parsed > 0 ? parsed : null;
}

/** Pull numeric prices from agent/ebay listing objects */
export function extractPricesFromListings(listings: unknown[]): number[] {
  const prices: number[] = [];

  for (const item of listings || []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    const candidates: unknown[] = [
      row.price,
      row.currentBid,
      row.current_bid,
      row.value,
      row.amount,
    ];

    const priceObj = row.price;
    if (priceObj && typeof priceObj === "object") {
      const nested = priceObj as Record<string, unknown>;
      candidates.unshift(nested.value, nested.amount);
    }

    for (const candidate of candidates) {
      const parsed = parsePriceString(candidate);
      if (parsed) prices.push(parsed);
    }

    const title = String(row.title || "");
    const titleMatch = title.match(/\$\s*([\d,]+\.?\d*)/);
    if (titleMatch) {
      const fromTitle = parsePriceString(titleMatch[1]);
      if (fromTitle) prices.push(fromTitle);
    }
  }

  return prices;
}

export function medianOfPrices(prices: number[]): number | null {
  const valid = prices.filter((p) => p > 0).sort((a, b) => a - b);
  if (valid.length === 0) return null;

  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 !== 0
    ? valid[mid]
    : (valid[mid - 1] + valid[mid]) / 2;
}

/** Trimmed mean; falls back to median when sample is too small */
export function trimmedMeanOfPrices(
  prices: number[],
  trimFraction = 0.1
): number | null {
  const valid = prices.filter((p) => p > 0).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  if (valid.length < 3) return medianOfPrices(valid);

  const trimCount = Math.max(1, Math.floor(valid.length * trimFraction));
  const sliced = valid.slice(trimCount, valid.length - trimCount);
  if (sliced.length === 0) return medianOfPrices(valid);

  const mean = sliced.reduce((sum, p) => sum + p, 0) / sliced.length;
  return mean > 0 ? mean : medianOfPrices(valid);
}

/** eBay-only fallback when the Python agent is unavailable */
export function resolveValuationFromListings(opts: {
  finalPrice?: unknown;
  activeListings?: unknown[];
  soldListings?: unknown[];
  logPrefix?: string;
}): ValuationResult {
  const prefix = opts.logPrefix || "Pricing";
  const active = opts.activeListings ?? [];
  const sold = opts.soldListings ?? [];

  console.log(
    `[${prefix}] RAW active_listings (${active.length}):`,
    JSON.stringify(active.slice(0, 8))
  );
  console.log(
    `[${prefix}] RAW sold_listings (${sold.length}):`,
    JSON.stringify(sold.slice(0, 8))
  );

  const soldPrices = extractPricesFromListings(sold);
  const activePrices = extractPricesFromListings(active);
  const allPrices = [...soldPrices, ...activePrices];

  console.log(`[${prefix}] Parsed sold prices:`, soldPrices);
  console.log(`[${prefix}] Parsed active prices:`, activePrices);
  console.log(`[${prefix}] Combined price pool (${allPrices.length}):`, allPrices);

  const headerPrice = parsePriceString(opts.finalPrice);
  if (headerPrice && headerPrice > 0.01) {
    console.log(`[${prefix}] Using header price:`, headerPrice);
    return {
      price: parseFloat(headerPrice.toFixed(2)),
      method: "header_price",
    };
  }

  const trimmed = trimmedMeanOfPrices(allPrices);
  if (trimmed && trimmed > 0.01) {
    console.log(`[${prefix}] Using trimmed mean:`, trimmed);
    return {
      price: parseFloat(trimmed.toFixed(2)),
      method: soldPrices.length > 0 ? "trimmed_mean_sold" : "trimmed_mean_active",
    };
  }

  const median = medianOfPrices(allPrices);
  if (median && median > 0.01) {
    console.log(`[${prefix}] Using listing median fallback:`, median);
    return {
      price: parseFloat(median.toFixed(2)),
      method: "listing_median_fallback",
    };
  }

  console.warn(`[${prefix}] No parseable prices — fallback_unpriced`);
  return { price: 0.00, method: "fallback_unpriced" };
}

/** Map eBay Browse API items into listing-shaped rows for shared parsing */
export function ebayItemsToListings(
  items: Array<{
    title?: string;
    price?: { value?: string };
    itemWebUrl?: string;
    image?: { imageUrl?: string };
  }>
): Record<string, unknown>[] {
  return (items || []).map((item) => ({
    title: item.title,
    price: item.price?.value,
    url: item.itemWebUrl,
    image_url: item.image?.imageUrl,
  }));
}
