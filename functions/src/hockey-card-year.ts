/**
 * Defensive year normalization for hockey cards (especially vintage OPC/Topps).
 * Keep in sync with src/lib/hockey-card-year.ts
 */

export type HockeyCardIdentity = {
  year?: string;
  brand?: string;
  player?: string;
  cardNumber?: string;
  set?: string | null;
  frontTextLines?: string[];
  backTextLines?: string[];
};

export type HockeyYearNormalization = {
  year: string;
  corrected: boolean;
  reason?: string;
};

const CHECKLIST_YEAR_OVERRIDES: Array<{
  test: (card: HockeyCardIdentity, text: string) => boolean;
  year: string;
  reason: string;
}> = [
  {
    test: (card, text) =>
      isGretzky(card) &&
      isOpcOrTopps(card) &&
      cardNumber(card) === "120" &&
      hasKings(text),
    year: "1988-89",
    reason: "OPC/Topps Gretzky #120 Kings → 1988-89 product season",
  },
];

export function normalizeSeason(raw: string): string {
  const t = raw.trim();
  const match = t.match(/(\d{4})\s*[-–/]\s*(\d{2,4})/);
  if (match) {
    const start = match[1];
    let end = match[2];
    if (end.length === 4) {
      end = end.slice(-2);
    }
    return `${start}-${end.padStart(2, "0").slice(-2)}`;
  }
  const single = t.match(/^(\d{4})$/);
  if (single) {
    const y = parseInt(single[1], 10);
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  }
  return t;
}

function cardNumber(card: HockeyCardIdentity): string {
  return (card.cardNumber || "").replace(/^#/, "").trim();
}

function isGretzky(card: HockeyCardIdentity): boolean {
  return /gretzky/i.test(card.player || "");
}

function isOpcOrTopps(card: HockeyCardIdentity): boolean {
  return /o-pee-chee|o pee chee|\bopc\b|topps/i.test(card.brand || "");
}

function hasKings(text: string): boolean {
  return /los angeles kings|\bkings\b/i.test(text);
}

function seasonStartYear(year: string): number {
  const normalized = normalizeSeason(year);
  const m = normalized.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : 0;
}

export function extractCopyrightSeason(text: string): string | undefined {
  const m =
    text.match(/©\s*(\d{4})/i) ||
    text.match(/copyright\s*(\d{4})/i) ||
    text.match(/(\d{4})\s+O-PEE-CHEE/i);
  if (!m) return undefined;
  const y = parseInt(m[1], 10);
  if (y < 1960 || y > 2030) return undefined;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

function isImpossibleGretzkyOpcYear(year: string): boolean {
  if (!year.trim()) return false;
  const start = seasonStartYear(year);
  return start > 0 && start < 1979;
}

function combinedText(card: HockeyCardIdentity): string {
  const lines = [...(card.frontTextLines ?? []), ...(card.backTextLines ?? [])];
  return [lines.join("\n"), card.set || "", card.brand || "", card.player || ""]
    .join("\n")
    .toLowerCase();
}

export function normalizeHockeyCardYear(
  card: HockeyCardIdentity
): HockeyYearNormalization {
  const text = combinedText(card);
  let year = normalizeSeason(card.year || "");
  let corrected = false;
  let reason: string | undefined;

  const copyrightSeason = extractCopyrightSeason(text);
  if (copyrightSeason && copyrightSeason !== year) {
    const copyrightStart = seasonStartYear(copyrightSeason);
    const parsedStart = seasonStartYear(year);
    if (
      !year ||
      isImpossibleGretzkyOpcYear(year) ||
      (parsedStart > 0 && copyrightStart > parsedStart)
    ) {
      year = copyrightSeason;
      corrected = true;
      reason = `Copyright line → ${copyrightSeason}`;
    }
  }

  for (const override of CHECKLIST_YEAR_OVERRIDES) {
    if (override.test(card, text)) {
      if (year !== override.year) {
        year = override.year;
        corrected = true;
        reason = override.reason;
      }
      return { year, corrected, reason };
    }
  }

  if (isGretzky(card) && isOpcOrTopps(card) && isImpossibleGretzkyOpcYear(year)) {
    if (copyrightSeason) {
      year = copyrightSeason;
      corrected = true;
      reason = `Rejected impossible Gretzky year; using copyright ${copyrightSeason}`;
    } else if (cardNumber(card) === "120" && hasKings(text)) {
      year = "1988-89";
      corrected = true;
      reason = "Rejected pre-rookie Gretzky year; OPC #120 Kings → 1988-89";
    }
  }

  return { year: year || card.year || "", corrected, reason };
}
