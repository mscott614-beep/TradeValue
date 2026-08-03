/**
 * Slab-to-Raw arbitrage detection — canonical logic (synced to functions).
 */

export type ArbitrageConfidence = "low" | "medium" | "high";

/** eBay Sports Trading Cards */
export const EBAY_CATEGORY_SPORTS = "261328";
/** eBay CCG Individual Cards (Pokemon / TCG) */
export const EBAY_CATEGORY_TCG = "183454";

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
  /** Override Browse category_ids (default sports 261328). */
  categoryId?: string;
  /** Optional Browse price:[min..max] filter. */
  priceFilter?: { min?: number; max?: number };
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

/** Shared max for DEFAULT + market_reports merge (env overrides in scanner). */
export const DEFAULT_MAX_WATCHLIST = 40;

export const DEFAULT_WATCHLIST: CardWatchDescriptor[] = [
  // NBA
  {
    player: "Victor Wembanyama",
    year: "2023-24",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "275",
    expectedMultiplier: 8,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 5000 },
  },
  {
    player: "Caitlin Clark",
    year: "2024",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "1",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 3000 },
  },
  {
    player: "Luka Doncic",
    year: "2018-19",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "280",
    expectedMultiplier: 7,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 10, max: 5000 },
  },
  {
    player: "Anthony Edwards",
    year: "2020-21",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "258",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 2500 },
  },
  {
    player: "Paolo Banchero",
    year: "2022-23",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "249",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 2000 },
  },
  {
    player: "Chet Holmgren",
    year: "2022-23",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "236",
    expectedMultiplier: 6,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 2000 },
  },
  {
    player: "Jayson Tatum",
    year: "2017-18",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "16",
    expectedMultiplier: 7,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 10, max: 4000 },
  },
  {
    player: "Stephen Curry",
    year: "2009-10",
    brand: "Panini",
    set: "Prestige",
    cardNumber: "206",
    expectedMultiplier: 10,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 20, max: 8000 },
  },
  // NHL
  {
    player: "Connor McDavid",
    year: "2015-16",
    brand: "Upper Deck",
    set: "Young Guns",
    cardNumber: "201",
    expectedMultiplier: 10,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 20, max: 8000 },
  },
  {
    player: "Wayne Gretzky",
    year: "1988-89",
    brand: "O-Pee-Chee",
    cardNumber: "120",
    expectedMultiplier: 12,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 10, max: 5000 },
  },
  {
    player: "Auston Matthews",
    year: "2016-17",
    brand: "Upper Deck",
    set: "Young Guns",
    cardNumber: "201",
    expectedMultiplier: 8,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 15, max: 5000 },
  },
  {
    player: "Connor Bedard",
    year: "2023-24",
    brand: "Upper Deck",
    set: "Young Guns",
    cardNumber: "201",
    expectedMultiplier: 8,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 10, max: 5000 },
  },
  {
    player: "Sidney Crosby",
    year: "2005-06",
    brand: "Upper Deck",
    set: "Young Guns",
    cardNumber: "201",
    expectedMultiplier: 10,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 25, max: 10000 },
  },
  // NFL
  {
    player: "Caleb Williams",
    year: "2024",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "301",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 3000 },
  },
  {
    player: "Jayden Daniels",
    year: "2024",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "389",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 3000 },
  },
  {
    player: "Patrick Mahomes",
    year: "2017",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "269",
    expectedMultiplier: 8,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 20, max: 10000 },
  },
  {
    player: "Justin Jefferson",
    year: "2020",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "398",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 10, max: 4000 },
  },
  {
    player: "Joe Burrow",
    year: "2020",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "307",
    expectedMultiplier: 7,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 10, max: 5000 },
  },
  {
    player: "C.J. Stroud",
    year: "2023",
    brand: "Panini",
    set: "Prizm",
    cardNumber: "339",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 3000 },
  },
  // MLB
  {
    player: "Shohei Ohtani",
    year: "2018",
    brand: "Topps",
    set: "Update",
    cardNumber: "US1",
    expectedMultiplier: 9,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 20, max: 10000 },
  },
  {
    player: "Elly De La Cruz",
    year: "2024",
    brand: "Topps",
    set: "Chrome",
    cardNumber: "1",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 2500 },
  },
  {
    player: "Paul Skenes",
    year: "2024",
    brand: "Topps",
    set: "Chrome",
    cardNumber: "89",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 2500 },
  },
  {
    player: "Ronald Acuna Jr",
    year: "2018",
    brand: "Topps",
    set: "Update",
    cardNumber: "US250",
    expectedMultiplier: 8,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 15, max: 5000 },
  },
  {
    player: "Juan Soto",
    year: "2018",
    brand: "Topps",
    set: "Update",
    cardNumber: "US300",
    expectedMultiplier: 7,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 10, max: 4000 },
  },
  // Pokemon / TCG
  {
    player: "Charizard",
    year: "1999",
    brand: "Pokemon",
    set: "Base Set",
    cardNumber: "4",
    expectedMultiplier: 15,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_TCG,
    priceFilter: { min: 50, max: 50000 },
  },
  {
    player: "Pikachu",
    year: "1999",
    brand: "Pokemon",
    set: "Base Set",
    cardNumber: "58",
    expectedMultiplier: 10,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_TCG,
    priceFilter: { min: 10, max: 5000 },
  },
  {
    player: "Umbreon",
    year: "2023",
    brand: "Pokemon",
    set: "Obsidian Flames",
    cardNumber: "215",
    expectedMultiplier: 8,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_TCG,
    priceFilter: { min: 20, max: 10000 },
  },
  {
    player: "Mew",
    year: "2021",
    brand: "Pokemon",
    set: "Celebrations",
    cardNumber: "25",
    expectedMultiplier: 8,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_TCG,
    priceFilter: { min: 15, max: 5000 },
  },
  {
    player: "Lugia",
    year: "2000",
    brand: "Pokemon",
    set: "Neo Genesis",
    cardNumber: "9",
    expectedMultiplier: 12,
    gradingPassRate: "moderate",
    categoryId: EBAY_CATEGORY_TCG,
    priceFilter: { min: 30, max: 15000 },
  },
  // Extra high-liquidity sports
  {
    player: "Travis Hunter",
    year: "2025",
    brand: "Panini",
    set: "Prizm",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 3000 },
  },
  {
    player: "Cooper Flagg",
    year: "2025-26",
    brand: "Panini",
    set: "Prizm",
    expectedMultiplier: 7,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 10, max: 5000 },
  },
  {
    player: "Jackson Holliday",
    year: "2024",
    brand: "Topps",
    set: "Chrome",
    expectedMultiplier: 6,
    gradingPassRate: "high",
    categoryId: EBAY_CATEGORY_SPORTS,
    priceFilter: { min: 5, max: 2500 },
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
  rows: Array<{ card?: string; multiplier_x?: number | string }>,
  maxRows: number = DEFAULT_MAX_WATCHLIST
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
  return out.slice(0, maxRows);
}

export function isSignalActive(
  signal: Partial<ArbitrageSignal> & Record<string, any>,
  nowIso: string = new Date().toISOString()
): boolean {
  if (!signal) return false;
  if (signal.qualifies === false) return false;
  if (signal.status === "expired") return false;
  if (signal.expiresAt && signal.expiresAt <= nowIso) return false;
  return true;
}
