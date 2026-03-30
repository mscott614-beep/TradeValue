import { genkit } from 'genkit';
import { z } from 'zod';
import { ai } from '../genkit';

export const generateMarketReportSchema = z.object({
    topic: z.string().optional().describe("Optional specific topic to focus the report on."),
    trendingData: z.array(z.object({
        player: z.string(),
        title: z.string(),
        value: z.string(),
        change: z.string(),
        trend: z.enum(["up", "down"]),
    })).optional().describe("Current trending cards to include in the market snapshot table."),
});

export const generateMarketReport = ai.defineFlow(
    {
        name: 'generateMarketReport',
        inputSchema: generateMarketReportSchema,
        outputSchema: z.string(),
    },
    async (input) => {
        const focusContext = input.topic
            ? `Specific interest: ${input.topic}.`
            : `General High-end Sportscard Market.`;

        const trendingContext = input.trendingData && input.trendingData.length > 0
            ? `CURRENT MARKET MOVERS (Include in Snapshot Table):\n${JSON.stringify(input.trendingData.slice(0, 4), null, 2)}`
            : '';

        const prompt = `
      You are a Senior Market Analyst for TradeValue, writing a premium "Confidential Market Intelligence" report for high-net-worth sports card investors. 
      
      CONTEXT:
      ${focusContext}
      ${trendingContext}

      STRUCTURAL RULES (STRICT ADHERENCE REQUIRED):

      # EXECUTIVE SUMMARY (BLUF)
      Write exactly 3 concise sentences providing a "Bottom Line Up Front" (BLUF) on the current market state, momentum, and primary sentiment (e.g., Bullish/Bearish/Neutral).

      # MARKET SNAPSHOT
      Generate a 3-column Markdown table summarizing the most important movers:
      | Card Name | Current Value | % Change (24h/7d) |
      | :--- | :--- | :--- |
      (Use the provided CURRENT MARKET MOVERS. If no movers are provided, use 4 marquee high-end cards like 2005 Upper Deck Crosby YG, 2015 McDavid YG, etc.)

      ## Market Sentiment
      Analyze current trading volume, liquidity trends, and whether capital is flowing into "Safe Haven" vintage or "High-Growth" modern prospects.

      ## Hot Prospects
      Identify 2-3 specific player sets or brands that are currently "over-indexed" for growth. Explain the fundamental catalyst (e.g., injury return, playoff push, supply crunch).

      ## Risk Analysis
      Identify specific "Red Flag" segments (e.g., overproduced 2020-21 base cards) or potential liquidity traps where bid-ask spreads are widening.

      > **INVESTMENT CALL**: [Provide a single, definitive actionable sentence here. Be bold and data-driven.]

      FOOTER:
      Confidential Market Intelligence | [Current Date]
    `;

        const response = await ai.generate({
            model: 'googleai/gemini-3.1-flash-lite-preview',
            prompt: prompt,
        });

        return response.text;
    }
);
