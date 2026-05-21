/**
 * AUTO-GENERATED — do not edit.
 * Canonical source: src/lib/institutional-report-prompt.ts
 * Regenerate: node scripts/sync-shared-libs.mjs (runs via functions prebuild)
 */

/**
 * Canonical institutional market report prompt (newsletter, marketReportV2, Genkit UI).
 */

export type InstitutionalReportInput = {
  topic?: string;
  trendingData?: unknown[];
  reportDate?: string;
};

export function buildInstitutionalReportPrompt(
  input: InstitutionalReportInput = {}
): string {
  const focusContext = input.topic
    ? `Specific interest: ${input.topic}.`
    : "General high-end sportscard and TCG alternative-asset market.";

  const trendingContext =
    input.trendingData && Array.isArray(input.trendingData) && input.trendingData.length > 0
      ? `CURRENT MARKET MOVERS:\n${JSON.stringify(input.trendingData.slice(0, 4), null, 2)}`
      : "";

  const reportDate = input.reportDate ?? new Date().toISOString().split("T")[0];

  return `You are the TradeValue Institutional Research Desk (Gemini 3.5 Flash).
Author an institutional-grade ALTERNATIVE-ASSET market report for high-net-worth collectors.

DO NOT write a broad, generic macro blog post. Use concise, data-dense prose grounded in recent market knowledge.

CONTEXT:
${focusContext}
${trendingContext}
Report date: ${reportDate}

CRITICAL FORMATTING RULES:
1. Every Markdown table row MUST be on its own line. NEVER join rows with ||.
2. Place a blank line BEFORE and AFTER every table block.
3. Pipe characters start at column 0. Do NOT indent table rows.

MANDATORY STRUCTURE — use these exact section headings and place --- on its own line between sections 1-2, 2-3, and 3-4:

# 1. Macro Market Sentiment & Liquidity

Include subsection **Market Velocity Alert** summarizing transactional velocity and week-over-week acceleration/deceleration.

| Metric | Current Reading | WoW Change | Interpretation |
| :--- | :--- | :--- | :--- |
| [metric] | [value] | [delta] | [note] |

---

# 2. High-Velocity Modern & Prospect Tracker

| Asset | 7d Change | Liquidity | Game-to-Game Note | Catalyst |
| :--- | :--- | :--- | :--- | :--- |
| [asset] | [%] | [score] | [swing] | [driver] |

---

# 3. Blue-Chip & Registry Asset Analysis

| Asset | PSA10 Population | Auction Baseline | Volatility | Stability Note |
| :--- | :--- | :--- | :--- | :--- |
| [asset] | [pop] | [baseline] | [profile] | [note] |

---

# 4. Slab-to-Raw Premium Multipliers Matrix

| Card | Raw Median | PSA10 Median | Multiplier (x) | Source Note |
| :--- | :--- | :--- | :--- | :--- |
| [card] | [$] | [$] | [Nx] | [comps] |

End with one bold **ALLOCATOR CALL** sentence.

---
TradeValue Institutional Report | ${reportDate}`;
}
