import { z } from 'zod';
import { ai, generateWithFallback, PRIMARY_MODEL } from '../genkit';
import { AlertConfig, Portfolio } from '@/lib/types';
import { ebayService } from '@/lib/ebay';
import { buildEbayQuery, calculateTradeValue } from '@/lib/ebay-pricing';

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
    alerts: z.array(MarketAlertSchema.extend({
        isVerified: z.boolean().optional(),
        groundedPrice: z.number().optional(),
        liquidityLevel: z.enum(['Low', 'Moderate', 'High']).optional(),
    })),
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
                // Grounded Search via Lead Data Architect logic
                const { query: groundedQuery } = buildEbayQuery({
                    year: card.year,
                    brand: card.brand,
                    set: card.set,
                    player: card.player,
                    cardNumber: card.cardNumber,
                    parallel: card.parallel,
                    condition: card.condition
                });

                const activeResponse = await ebayService.searchActiveItems(groundedQuery, 10);
                const rawItems = activeResponse.itemSummaries || [];
                
                // Calculate Grounded Price
                const calc = calculateTradeValue(rawItems);
                const groundedPrice = calc.value;

                // Logical Discrepancy Check
                // If the grounded price is suspiciously low compared to the portfolio value (e.g. $1.38 vs $141)
                // we flag it for re-scan or discard to prevent hallucinations.
                const portfolioValue = card.currentMarketValue || 0;
                const isIllogical = portfolioValue > 20 && groundedPrice < (portfolioValue * 0.1);

                if (isIllogical) {
                    console.log(`[Shadow] Discrepancy detected for ${card.player}: $${groundedPrice} vs $${portfolioValue}. Discarding hallucinated data.`);
                    return {
                        id: card.id,
                        name: `${card.year} ${card.brand} ${card.player}`,
                        currentMarketValue: portfolioValue,
                        hasLiveData: false,
                        isHallucination: true
                    };
                }

                return {
                    id: card.id,
                    name: `${card.year} ${card.brand} ${card.player}`,
                    currentMarketValue: portfolioValue,
                    liveListingsCount: activeResponse.total || 0,
                    liveAvgPrice: groundedPrice,
                    hasLiveData: (activeResponse.total || 0) > 0,
                    isVerified: true,
                    liquidity: activeResponse.total > 15 ? 'High' : activeResponse.total > 5 ? 'Moderate' : 'Low'
                };
            } catch (error) {
                console.error(`Failed to fetch grounded market data for ${card.player}:`, error);
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
                return `[VERIFIED] ${ctx.name}: Liquidity: ${ctx.liquidity}. Grounded Price: $${ctx.liveAvgPrice?.toFixed(2)}. Your Value: $${ctx.currentMarketValue}`;
            } else if ((ctx as any).isHallucination) {
                return `[BLOCK] ${ctx.name}: Grounded search returned illogical pricing ($${(ctx as any).liveAvgPrice || 'N/A'}). Data discarded to prevent hallucination.`;
            } else {
                return `[NO LIVE DATA] ${ctx.name}: No active eBay listings found for this specific card today. Fall back to historical context.`;
            }
        }).join('\n');

        const configSummary = alertsConfig.map((ac: AlertConfig) =>
            `Target: ${ac.targetType}=${ac.targetValue} | Condition: ${ac.condition} | Threshold: ${ac.threshold}`
        ).join('\n');

        const prompt = `
      You are the "Shadow" Market Intelligence Engine v2 for TradeValue. 
      You provide premium, confidential market analysis and "Smart Notifications" for high-net-worth investors.

      Scan Type: ${scanType === 'deep' ? "FULL PORTFOLIO DEEP SCAN" : "STANDARD SWEEP"}

      Active User Alert Rules:
      ${configSummary || "No custom rules set."}

      ---
      GROUNDED MARKET CONTEXT:
      ${marketSummaryLines}
      ---

      Your task is to analyze these market conditions against this portfolio and the user's rules.

      CRITICAL PERSONA & FORMATTING RULES:
      1. Use [VERIFIED] data where available. Compare actual Grounded Prices against alert thresholds.
      2. Persona: Be concise, authoritative, and data-driven. 
      3. Formatting: Use Markdown for the message. Bold key price points. Use professional investor-grade language.
      4. If [BLOCK] or [NO LIVE DATA] is reported, provide historical context but do NOT use the discarded price.
      5. Output EXACTLY 100% valid JSON matching the schema.

      Output JSON format:
      {
        "alerts": [
          {
             "type": "rise" | "drop" | "optimal_sell" | "red_flag",
             "title": "Short catchy title",
             "message": "Markdown formatted explanation. e.g. **Market Surge detected.** Price is up to **$150.00**.",
             "relatedCardId": "ID",
             "isVerified": boolean,
             "groundedPrice": number,
             "liquidityLevel": "Low" | "Moderate" | "High"
          }
        ]
      }
      
      Limit to 3-5 of the most important, high-impact alerts.
    `;

        const response = await generateWithFallback({
            model: PRIMARY_MODEL,
            prompt: prompt,
            output: { format: 'json' }
        });

        // Add 120s timeout reliability context to the call
        // (Handled by the execution environment, but we ensure prompt doesn't ask for massive tasks)

        return response.output as any;
    }
);

