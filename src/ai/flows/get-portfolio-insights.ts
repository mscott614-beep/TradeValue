import { genkit } from 'genkit';
import { z } from 'zod';
import { ai } from '../genkit';

const RecommendationSchema = z.object({
    cardId: z.string().optional(),
    cardTitle: z.string(),
    action: z.enum(['Sell', 'Buy', 'Hold', 'Hidden Gem']),
    reason: z.string(),
});

export const getPortfolioInsightsSchema = z.object({
    cards: z.array(z.any()), // We'll pass the Portfolio[] array
});

export const getPortfolioInsightsOutputSchema = z.object({
    riskScore: z.number().min(1).max(100),
    riskLevel: z.enum(['Low', 'Moderate', 'High']),
    recommendations: z.array(RecommendationSchema),
    optimizationAdvice: z.array(z.string()),
    healthSummary: z.string(),
});

export const getPortfolioInsights = ai.defineFlow(
    {
        name: 'getPortfolioInsights',
        inputSchema: getPortfolioInsightsSchema,
        outputSchema: getPortfolioInsightsOutputSchema,
    },
    async (input) => {
        const cardsSummary = input.cards.map(c =>
            `${c.year} ${c.brand} ${c.player} (${c.condition}) - Value: $${c.currentMarketValue}`
        ).join('\n');

        const prompt = `
      You are an expert sports card portfolio manager and investment strategist. 
      Analyze the following collection of trading cards and provide an executive "Market Insights" report.

      Collection Summary:
      ${cardsSummary}

      Your goal is to evaluate the portfolio's health, risk, and growth potential. 
      
      Consider these factors:
      - Diversification: Is the user too heavily invested in one era (e.g., "Junk Wax" 1987-1994)?
      - Quality: Is there a good balance of Graded vs Raw cards? 
      - Liquidity: Are these high-demand star players or common base cards?
      - Market Trends: Which cards are likely "peaking" in value (Sell) vs undervalued "Hidden Gems" (Buy/Hold)?

      Please output a JSON object matching this schema:
      {
        "riskScore": number (1-100, where 100 is extremely high risk),
        "riskLevel": "Low" | "Moderate" | "High",
        "recommendations": [
          {
            "cardTitle": "String",
            "action": "Sell" | "Buy" | "Hold" | "Hidden Gem",
            "reason": "Clear explanation of the market logic"
          }
        ],
        "optimizationAdvice": ["Actionable step 1", "Actionable step 2"],
        "healthSummary": "A 2-3 sentence executive overview of the portfolio's status."
      }

      Focus on being realistic. If the portfolio is full of 1991 Score base cards, the risk score should be high (90+) because they are overproduced and have low liquidity.
    `;

        const response = await ai.generate({
            model: 'googleai/gemini-2.5-flash', // Switching to 2.5 flash to avoid 2.0 quota limits
            prompt: prompt,
            output: { format: 'json' }
        });

        return response.output as any;
    }
);
