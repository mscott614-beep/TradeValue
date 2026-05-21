/**
 * Slab-to-Raw arbitrage detection — canonical logic (synced to functions).
 */

export type ArbitrageConfidence = "low" | "medium" | "high";

export type CardWatchDescriptor = {
  player: string;
  year: string;
  brand: string;
  cardNumber?: string;
  set?: string;
  parallel?: string;
  title?: string;
  expectedMultiplier?: number;
  gradingPassRate?: "low" | "moderate" | "high";
};

export type ArbitrageSignal = {
  id: string;
  cardKey: string;
  player: string;
  year: string;
  brand: string;
  cardNumber: string;
  title: string;
  rawMedianUsd: number;
  slabMedianUsd: number;
  multiplierObserved: number;
  multiplierExpected: number;
  spreadUsd: number;
  spreadPct: number;
  arbitrageScore: number;
  confidence: ArbitrageConfidence;
  gradingPassRate: "low" | "moderate" | "high";
  gradingNote: string;
  bestRawListing?: {
    title: string;
    price: number;
    url: string;
    imageUrl?: string;
  };
  rawQuery: string;
  slabQuery: string;
  detectedAt: string;
  expiresAt: string;
  status: "active" | "expired";
};

export const DEFAULT_WATCHLIST: CardWatchDescriptor[] = [
  {
    player: "Victor Wembanyama",
    year: "2023-24",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "275",
    expectedMultiplier: 8,
    gradingPassRate: "high",
  },
  {
    player: "Connor McDavid",
    year: "2015-16",
    brand: "Upper Deck",
    set: "Young Guns",
    cardNumber: "201",
    expectedMultiplier: 10,
    gradingPassRate: "moderate",
  },
  {
    player: "Wayne Gretzky",
    year: "1988-89",
    brand: "O-Pee-Chee",
    cardNumber: "120",
    expectedMultiplier: 12,
    gradingPassRate: "high",
  },
  {
    player: "Charizard",
    year: "1999",
    brand: "Pokemon",
    set: "Base Set",
    cardNumber: "4",
    expectedMultiplier: 15,
    gradingPassRate: "moderate",
  },
  {
    player: "Caitlin Clark",
    year: "2024",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "1",
    expectedMultiplier: 6,
    gradingPassRate: "high",
  },
];

export function buildCardKey(d: CardWatchDescriptor): string {
  return [
    d.year,
    d.brand,
    d.set || "",
    d.player,
    d.cardNumber || "",
    d.parallel || "",
  ]
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function parseMultiplierRow(cardLabel: string): number {
  const m = String(cardLabel).match(/(\d+(?:\.\d+)?)\s*x/i);
  if (m) return parseFloat(m[1]);
  return 8;
}

export function gradingNoteFor(passRate: CardWatchDescriptor["gradingPassRate"], expectedMult: number): string {
  const rate = passRate || (expectedMult >= 10 ? "moderate" : "high");
  if (rate === "high") {
    return "Historically favorable gem rate for this segment; strong grade-and-flip candidate when raw comps are thin.";
  }
  if (rate === "moderate") {
    return "Moderate grading risk — verify centering and surface before submit; population volatility applies.";
  }
  return "Low pass-rate or high pop volatility; arbitrage spread may not survive grading economics.";
}

export function computeConfidence(
  rawMedian: number,
  slabMedian: number,
  observedMult: number,
  expectedMult: number,
  hasListing: boolean
): ArbitrageConfidence {
  if (rawMedian < 5 || slabMedian < 50) return "low";
  const ratio = observedMult / Math.max(expectedMult, 1);
  if (hasListing && ratio >= 1.5 && slabMedian >= 200) return "high";
  if (ratio >= 1.25 && slabMedian >= 100) return "medium";
  return "low";
}

export type ArbitrageScoreInput = {
  rawMedianUsd: number;
  slabMedianUsd: number;
  multiplierExpected: number;
  bestRawPrice?: number;
  gradingPassRate?: CardWatchDescriptor["gradingPassRate"];
};

/**
 * Score opportunity: high observed multiplier vs expected + underpriced raw listings.
 */
export function scoreArbitrageOpportunity(input: ArbitrageScoreInput): {
  qualifies: boolean;
  arbitrageScore: number;
  multiplierObserved: number;
  spreadUsd: number;
  spreadPct: number;
  confidence: ArbitrageConfidence;
  gradingNote: string;
} {
  const { rawMedianUsd, slabMedianUsd, multiplierExpected } = input;
  const expected = Math.max(multiplierExpected || 8, 2);
  const raw = Math.max(rawMedianUsd, 0.01);
  const slab = Math.max(slabMedianUsd, 0);
  const observedMult = slab / raw;
  const spreadUsd = slab - raw;
  const spreadPct = raw > 0 ? ((slab - raw) / raw) * 100 : 0;

  const impliedFairRaw = slab / expected;
  const listingPrice = input.bestRawPrice ?? raw;
  const listingDiscount =
    impliedFairRaw > 0 ? (impliedFairRaw - listingPrice) / impliedFairRaw : 0;

  const multRatio = observedMult / expected;
  let score = 0;
  score += Math.min(40, Math.max(0, (multRatio - 1) * 25));
  score += Math.min(35, Math.max(0, listingDiscount * 100));
  score += Math.min(25, spreadUsd / 50);

  const qualifies =
    slab >= 75 &&
    spreadUsd >= 40 &&
    multRatio >= 1.2 &&
    (listingDiscount >= 0.15 || multRatio >= 1.4);

  const confidence = computeConfidence(
    raw,
    slab,
    observedMult,
    expected,
    Boolean(input.bestRawPrice && listingDiscount >= 0.1)
  );

  return {
    qualifies,
    arbitrageScore: Math.round(Math.min(100, score)),
    multiplierObserved: parseFloat(observedMult.toFixed(2)),
    spreadUsd: parseFloat(spreadUsd.toFixed(2)),
    spreadPct: parseFloat(spreadPct.toFixed(1)),
    confidence,
    gradingNote: gradingNoteFor(input.gradingPassRate, expected),
  };
}

export function watchlistFromReportRows(
  rows: Array<{ card?: string; multiplier_x?: number | string }>
): CardWatchDescriptor[] {
  const out: CardWatchDescriptor[] = [];
  for (const row of rows || []) {
    const label = String(row.card || "").trim();
    if (!label || label.length < 4) continue;
    const expected = parseMultiplierRow(label);
    if (typeof row.multiplier_x === "number") {
      out.push({
        player: label,
        year: "",
        brand: "",
        title: label,
        expectedMultiplier: row.multiplier_x,
        gradingPassRate: row.multiplier_x >= 12 ? "moderate" : "high",
      });
    } else {
      out.push({
        player: label.split(" ")[0] || label,
        year: "",
        brand: "",
        title: label,
        expectedMultiplier: expected,
        gradingPassRate: "moderate",
      });
    }
  }
  return out.slice(0, 12);
}
