import { z } from 'zod';
import { ai, generateWithFallback, PRIMARY_MODEL } from '../genkit';
import { ebayService } from '@/lib/ebay';
import { buildEbayQuery, calculateTradeValue } from '@/lib/ebay-pricing';

export const CardDeepDiveSchema = z.object({
    marketFloor: z.number().describe('Current lowest available price for this specific condition.'),
    recentVelocity: z.string().describe('Summary of sales volume over the last 30 days.'),
    investmentGrade: z.enum(['Strong Buy', 'Buy', 'Neutral', 'Hold', 'Sell', 'Strong Sell']).describe('Sentiment based on price drift and liquidity.'),
    analysis: z.string().describe('Markdown formatted detailed analysis.'),
    isGrounded: z.boolean().describe('True if sufficient data was found for a confident report.'),
    insufficientData: z.boolean().optional().describe('True if fail-fast logic triggered.'),
});

export const getCardDeepDive = ai.defineFlow(
    {
        name: 'getCardDeepDive',
        inputSchema: z.any(), // Portfolio object
        outputSchema: CardDeepDiveSchema,
    },
    async (card) => {
        try {
            // 1. Shadow Engine Grounding
            const { query: groundedQuery } = buildEbayQuery({
                year: card.year,
                brand: card.brand,
                set: card.set,
                player: card.player,
                cardNumber: card.cardNumber,
                parallel: card.parallel,
                condition: card.condition
            });

            // Fetch both active and sold for velocity
            let [activeResponse, soldResponse] = await Promise.all([
                ebayService.searchActiveItems(groundedQuery, 10),
                ebayService.searchSoldItems({ cardTitle: groundedQuery, limit: 20 })
            ]);

            let activeItems = activeResponse.itemSummaries || [];
            let soldItems = soldResponse.itemSummaries || [];

            // Fallback 1: If strict query (e.g. with PSA 9) returned fewer than 2 data points, retry without condition filter
            if (activeItems.length + soldItems.length < 2 && card.condition) {
                const { query: broaderQuery } = buildEbayQuery({
                    year: card.year,
                    brand: card.brand,
                    set: card.set,
                    player: card.player,
                    cardNumber: card.cardNumber,
                    parallel: card.parallel
                });
                const [broaderActive, broaderSold] = await Promise.all([
                    ebayService.searchActiveItems(broaderQuery, 10),
                    ebayService.searchSoldItems({ cardTitle: broaderQuery, limit: 20 })
                ]);
                if ((broaderActive.itemSummaries?.length || 0) + (broaderSold.itemSummaries?.length || 0) > activeItems.length + soldItems.length) {
                    activeItems = broaderActive.itemSummaries || activeItems;
                    soldItems = broaderSold.itemSummaries || soldItems;
                }
            }

            // Fallback 2: Direct title search if structured queries yielded low volume
            if (activeItems.length + soldItems.length < 2) {
                const rawSearchQuery = (card.title || `${card.year || ''} ${card.brand || ''} ${card.player || ''} ${card.cardNumber ? '#' + card.cardNumber : ''}`).trim();
                if (rawSearchQuery) {
                    const [rawActive, rawSold] = await Promise.all([
                        ebayService.searchActiveItems(rawSearchQuery, 10),
                        ebayService.searchSoldItems({ cardTitle: rawSearchQuery, limit: 20 })
                    ]);
                    if ((rawActive.itemSummaries?.length || 0) + (rawSold.itemSummaries?.length || 0) > activeItems.length + soldItems.length) {
                        activeItems = rawActive.itemSummaries || activeItems;
                        soldItems = rawSold.itemSummaries || soldItems;
                    }
                }
            }

            // 2. Fallback Baseline & Metrics Calculation
            const calc = calculateTradeValue(activeItems);
            const computedFloor = calc.value > 0 ? calc.value : (activeItems[0] ? parseFloat(activeItems[0].price?.value || activeItems[0].currentBidPrice?.value || '0') : 0);
            const groundedFloor = computedFloor > 0 ? computedFloor : (card.currentMarketValue || 0);

            const salesLast30 = soldItems.length;
            const avgSoldPrice = soldItems.length > 0 
                ? soldItems.reduce((acc, i) => acc + parseFloat(i.price?.value || i.currentBidPrice?.value || '0'), 0) / soldItems.length 
                : groundedFloor;

            const velocitySummary = salesLast30 > 0 || activeItems.length > 0
                ? `${salesLast30} confirmed sales found. ${activeItems.length} active listings currently competing for floor.`
                : `Low volume card. Analysis anchored by portfolio valuation baseline of $${groundedFloor.toFixed(2)}.`;

            // 4. Shadow Engine Persona Analysis
            const prompt = `
                You are the "Shadow" Market Intelligence Engine v2. 
                Perform an AI Deep Dive for this specific card: ${card.year} ${card.brand} ${card.player} ${card.parallel || ''}.

                GROUNDED MARKET DATA:
                - Market Floor: $${groundedFloor.toFixed(2)}
                - Recent Sales (Volume): ${velocitySummary}
                - Average Sold Price: $${avgSoldPrice.toFixed(2)}
                - User's Internal Value: $${card.currentMarketValue || 'Unknown'}

                TASK:
                1. Provide a professional, investor-grade analysis of this card's current market position.
                2. Use Markdown for formatting.
                3. Determine an "Investment Grade" sentiment. 
                - ALLOWED VALUES: "Strong Buy", "Buy", "Neutral", "Hold", "Sell", "Strong Sell"
                - If Market Floor < User Value, be cautious (Hold/Sell).
                - If Market Floor > User Value and Velocity is high, be bullish (Buy/Strong Buy).

                Output ONLY the raw JSON object. Do not include markdown code blocks or the schema description.
            `;

            const response = await generateWithFallback({
                model: PRIMARY_MODEL,
                prompt: prompt,
                output: { schema: CardDeepDiveSchema }
            });

            const result = response.output;

            if (!result) {
                throw new Error("Failed to generate structured output");
            }

            const finalFloor = (typeof result?.marketFloor === 'number' && result.marketFloor > 0)
                ? result.marketFloor
                : (groundedFloor > 0 ? groundedFloor : (card.currentMarketValue || 0));

            return {
                marketFloor: finalFloor,
                recentVelocity: result?.recentVelocity || velocitySummary,
                investmentGrade: (['Strong Buy', 'Buy', 'Neutral', 'Hold', 'Sell', 'Strong Sell'].includes(result?.investmentGrade) ? result.investmentGrade : 'Hold') as any,
                analysis: result?.analysis || `### Market Analysis\n\n- **Market Floor:** $${finalFloor.toFixed(2)}\n- **Velocity:** ${velocitySummary}`,
                isGrounded: true
            };

        } catch (error) {
            console.error("[Shadow] Deep Dive Failed:", error);
            return {
                marketFloor: 0,
                recentVelocity: 'Error',
                investmentGrade: 'Hold' as const,
                analysis: "The Shadow Engine encountered a technical error during grounding. Please try again.",
                isGrounded: false,
                insufficientData: true
            };
        }
    }
);
