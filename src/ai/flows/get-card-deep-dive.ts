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
            const [activeResponse, soldResponse] = await Promise.all([
                ebayService.searchActiveItems(groundedQuery, 10),
                ebayService.searchSoldItems({ cardTitle: groundedQuery, limit: 20 })
            ]);

            const activeItems = activeResponse.itemSummaries || [];
            const soldItems = soldResponse.itemSummaries || [];

            // 2. Fail-Fast Logic
            const totalDataPoints = activeItems.length + soldItems.length;
            if (totalDataPoints < 2) {
                return {
                    marketFloor: 0,
                    recentVelocity: 'No data',
                    investmentGrade: 'Hold',
                    analysis: "Insufficient Market Data: The Shadow Engine could not find enough matching listings to generate a high-confidence report. Data discarded to prevent hallucination.",
                    isGrounded: false,
                    insufficientData: true
                };
            }

            // 3. Grounded Metrics
            const calc = calculateTradeValue(activeItems);
            const marketFloor = calc.value;
            
            const salesLast30 = soldItems.length;
            const avgSoldPrice = soldItems.length > 0 
                ? soldItems.reduce((acc, i) => acc + parseFloat(i.price.value), 0) / soldItems.length 
                : 0;

            const velocitySummary = `${salesLast30} confirmed sales found. ${activeItems.length} active listings currently competing for floor.`;

            // 4. Shadow Engine Persona Analysis
            const prompt = `
                You are the "Shadow" Market Intelligence Engine v2. 
                Perform an AI Deep Dive for this specific card: ${card.year} ${card.brand} ${card.player} ${card.parallel || ''}.

                GROUNDED MARKET DATA:
                - Market Floor: $${marketFloor.toFixed(2)}
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
            let rawOutput = response.output as any;

            // Sanitization: If AI returned a string with JSON inside, parse it
            if (typeof rawOutput === 'string') {
                try {
                    // Find the first { and last }
                    const firstBrace = rawOutput.indexOf('{');
                    const lastBrace = rawOutput.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace !== -1) {
                        rawOutput = JSON.parse(rawOutput.substring(firstBrace, lastBrace + 1));
                    }
                } catch (e) {
                    console.error("[Shadow] Failed to parse raw string output:", e);
                }
            }

            return {
                marketFloor: rawOutput.marketFloor || marketFloor,
                recentVelocity: rawOutput.recentVelocity || velocitySummary,
                investmentGrade: rawOutput.investmentGrade || 'Hold',
                analysis: rawOutput.analysis || (typeof rawOutput === 'string' ? rawOutput : "Analysis generated."),
                isGrounded: true
            };

        } catch (error) {
            console.error("[Shadow] Deep Dive Failed:", error);
            return {
                marketFloor: 0,
                recentVelocity: 'Error',
                investmentGrade: 'Hold',
                analysis: "The Shadow Engine encountered a technical error during grounding. Please try again.",
                isGrounded: false,
                insufficientData: true
            };
        }
    }
);
