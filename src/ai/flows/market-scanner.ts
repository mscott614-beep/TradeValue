import { genkit } from 'genkit';
import { z } from 'zod';
import { ai } from '../genkit';
import { AlertConfig, Portfolio } from '@/lib/types';
import { ebayService } from '@/lib/ebay';

export const runMarketScannerSchema = z.object({
    cards: z.array(z.any()), // Portfolio[]
    alertsConfig: z.array(z.any()), // AlertConfig[]
    scanType: z.enum(['standard', 'deep']).optional().default('standard'),
    userEmail: z.string().optional()
});

const MarketAlertSchema = z.object({
    type: z.enum(['rise', 'drop', 'optimal_sell', 'red_flag']),
    title: z.string(),
    message: z.string(),
    relatedCardId: z.string().optional(),
});

export const runMarketScannerOutputSchema = z.object({
    alerts: z.array(MarketAlertSchema),
});

export const runMarketScanner = ai.defineFlow(
    {
        name: 'runMarketScanner',
        inputSchema: runMarketScannerSchema,
        outputSchema: runMarketScannerOutputSchema,
    },
    async (input) => {
        const { cards, alertsConfig, scanType, userEmail } = input;

        // Safety check - if no cards, return empty 
        if (!cards || cards.length === 0) {
            return { alerts: [] };
        }

        // 1. Identify Target Cards for Real-Time Lookup
        let targetCards: Portfolio[] = [];
        
        if (scanType === 'deep') {
            // Full Portfolio Scan (Limit logic handled in UI/Action, but we cap at 50 here for safety)
            targetCards = cards.slice(0, 50);
        } else {
            // Standard Scan: Prioritize cards that have active alert rules + top 5 high-value
            const activeRuleCardIds = new Set(
                alertsConfig
                    .filter(ac => ac.isActive && ac.targetType === 'player' && ac.targetValue)
                    .map(ac => ac.targetValue)
            );
            const prioritizedCards = [...cards].sort((a, b) => (b.currentMarketValue || 0) - (a.currentMarketValue || 0));
            targetCards = prioritizedCards.filter(c => 
                activeRuleCardIds.has(c.player) || prioritizedCards.indexOf(c) < 5
            ).slice(0, 10);
        }

        const marketDataContext = await Promise.all(targetCards.map(async (card) => {
            try {
                const query = `${card.year} ${card.brand} ${card.player} ${card.parallel || ''} ${card.cardNumber || ''}`.trim();
                const listings = await ebayService.searchActiveItems(query, 5);
                
                const prices = (listings.itemSummaries || []).map(item => parseFloat(item.price.value));
                const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
                const minPrice = prices.length > 0 ? Math.min(...prices) : 0;

                return {
                    id: card.id,
                    name: `${card.year} ${card.brand} ${card.player}`,
                    currentMarketValue: card.currentMarketValue,
                    liveListingsCount: listings.total || 0,
                    liveMinPrice: minPrice,
                    liveAvgPrice: avgPrice,
                    hasLiveData: (listings.total || 0) > 0
                };
            } catch (error) {
                console.error(`Failed to fetch market data for ${card.player}:`, error);
                return {
                    id: card.id,
                    name: `${card.year} ${card.brand} ${card.player}`,
                    currentMarketValue: card.currentMarketValue,
                    hasLiveData: false
                };
            }
        }));

        const marketSummaryLines = marketDataContext.map(ctx => {
            if (ctx.hasLiveData) {
                return `[LIVE DATA] ${ctx.name}: Found ${ctx.liveListingsCount} listings. Min: $${ctx.liveMinPrice?.toFixed(2)}, Avg: $${ctx.liveAvgPrice?.toFixed(2)}. Your Value: $${ctx.currentMarketValue}`;
            } else {
                return `[NO LIVE DATA] ${ctx.name}: No active eBay listings found for this specific card today. Fall back to historical context.`;
            }
        }).join('\n');

        const configSummary = alertsConfig.map((ac: AlertConfig) =>
            `Target: ${ac.targetType}=${ac.targetValue} | Condition: ${ac.condition} | Threshold: ${ac.threshold}`
        ).join('\n');

        const prompt = `
      You are an automated, high-frequency AI market watchdog for a sports card portfolio. 
      You have access to a user's current Portfolio, their custom Alert Rules, and REAL-TIME Live eBay Data for key items.

      Scan Type: ${scanType === 'deep' ? "FULL PORTFOLIO DEEP SCAN" : "STANDARD SWEEP"}

      Active User Alert Rules:
      ${configSummary || "No custom rules set."}

      ---
      MARKET CONTEXT (LIVE + HISTORICAL FALLBACK):
      ${marketSummaryLines}
      ---

      Your task is to analyze these market conditions against this portfolio and the user's rules.

      FOLLOW THESE CRITICAL RULES:
      1. Use [LIVE DATA] where available. Compare actual Min/Avg prices against alert thresholds. Be specific in messages.
      2. If [NO LIVE DATA] is reported for a card, DO NOT ignore it. Instead, FALL BACK to your historical knowledge of the sports market.
         - Mention that no live auctions were found, but provide context based on the player's recent performance or general historical trends for that series.
      3. Supply Surges: If 'liveListingsCount' is unusually high (e.g. > 50 for a mid-tier card), flag it as a 'red_flag' for potential dumping.
      4. Discrepancies: If currentMarketValue in the portfolio is significantly different from liveAvgPrice, suggest an 'optimal_sell' or high risk 'drop'.

      Output JSON format:
      {
        "alerts": [
          {
             "type": "rise" | "drop" | "optimal_sell" | "red_flag",
             "title": "Short catchy title",
             "message": "Detailed explanation. Use REAL prices if live, or HISTORICAL context if no live results found.",
             "relatedCardId": "ID of the specific card"
          }
        ]
      }
      
      Limit to 3-5 of the most important, high-impact alerts.
    `;

        const response = await ai.generate({
            model: 'googleai/gemini-3.1-flash-lite-preview',
            prompt: prompt,
            output: { format: 'json' }
        });

        return response.output as any;
    }
);

