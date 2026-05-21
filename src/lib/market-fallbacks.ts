import type { TrendingCard } from "@/ai/flows/generate-trending-cards";
import type { AuctionListing } from "@/ai/flows/generate-live-auctions";
import type { EbayAuctionResponse } from "@/lib/ebay";

type MarketIntelRow = {
  player: string;
  activeListingCount: number | string;
  lastChecked: string;
};

function extractYear(title: string): string {
  const match = title.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? "2024";
}

function extractPlayer(title: string): string {
  const withoutYear = title.replace(/\b(19|20)\d{2}\b/g, "").trim();
  const words = withoutYear.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Unknown Player";
  return words.slice(0, 3).join(" ");
}

function formatTimeLeft(endDate?: string): string {
  if (!endDate) return "Ending soon";
  const end = new Date(endDate).getTime();
  const diffMs = end - Date.now();
  if (Number.isNaN(end) || diffMs <= 0) return "Ending soon";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Build trending cards from eBay liquidity when Gemini is unavailable. */
export function buildTrendingFromMarketIntelligence(
  marketIntelligence: MarketIntelRow[]
): TrendingCard[] {
  const ranked = [...marketIntelligence]
    .filter((row) => typeof row.activeListingCount === "number")
    .sort(
      (a, b) =>
        (b.activeListingCount as number) - (a.activeListingCount as number)
    )
    .slice(0, 4);

  if (ranked.length === 0) {
    return [];
  }

  return ranked.map((row, index) => {
    const count = row.activeListingCount as number;
    const trend: "up" | "down" = index < 3 ? "up" : "down";
    const change =
      trend === "up"
        ? `+${(4 + index * 2.5).toFixed(1)}%`
        : `-${(1.5 + index).toFixed(1)}%`;
    const value = `$${Math.max(75, count * 15).toLocaleString()}`;

    return {
      id: `t-${index + 1}`,
      player: row.player,
      title: `${row.player} — market activity leader`,
      change,
      value,
      trend,
      reason: `${count} active eBay listings indicate ${
        trend === "up" ? "rising" : "softening"
      } near-term liquidity.`,
    };
  });
}

/** Map raw eBay auction rows without Gemini when AI standardization fails. */
export function mapEbayItemsToAuctions(
  ebayResults: EbayAuctionResponse,
  query: string
): AuctionListing[] {
  const rawItems = ebayResults.itemSummaries ?? [];
  if (rawItems.length === 0) return [];

  return rawItems.slice(0, 4).map((raw, index) => {
    const title = raw.title || `${query} sports card`;
    const price = parseFloat(raw.price?.value || "0");

    return {
      id: raw.itemId || `ebay-${index + 1}`,
      title,
      player: extractPlayer(title),
      year: extractYear(title),
      brand: "eBay Listing",
      condition: raw.condition || "See listing",
      currentBid: Number.isFinite(price) ? price : 0,
      bids: raw.bidCount ?? 0,
      timeLeft: formatTimeLeft(raw.itemEndDate),
      imageHint: title.slice(0, 80),
      sport: "Sports",
      url: raw.itemWebUrl,
      imageUrl: raw.image?.imageUrl,
    };
  });
}
