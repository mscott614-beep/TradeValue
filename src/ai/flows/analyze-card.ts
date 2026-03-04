import { genkit } from 'genkit';
import { z } from 'zod';
import { ai } from '../genkit';
import { Portfolio } from '@/lib/types';

export const analyzeCardInvestmentSchema = z.object({
    card: z.any(), // Portfolio object
});

export const analyzeCardInvestmentOutputSchema = z.object({
    gradingRoi: z.object({
        isRecommended: z.boolean(),
        estimatedCost: z.number(),
        potentialValueIncreasePercent: z.number(),
        reasoning: z.string()
    }),
    gradeProbabilities: z.object({
        psa10_percent: z.number(),
        psa9_percent: z.number(),
        psa8_or_lower_percent: z.number(),
        commonConditionIssues: z.string()
    }),
    investmentOutlook: z.object({
        shortTerm: z.enum(['Bearish', 'Neutral', 'Bullish']),
        longTerm: z.enum(['Bearish', 'Neutral', 'Bullish']),
        riskLevel: z.enum(['Low', 'Medium', 'High'])
    }),
    historicalSignificance: z.string(),
    comparisonMatchup: z.string().optional() // Used when running a comparison vs another card
});

export const analyzeCardInvestment = ai.defineFlow(
    {
        name: 'analyzeCardInvestment',
        inputSchema: analyzeCardInvestmentSchema,
        outputSchema: analyzeCardInvestmentOutputSchema,
    },
    async (input) => {
        const card: Portfolio = input.card;

        const prompt = `
      You are an expert sports card evaluator, historian, and investment analyst.
      Analyze the following card and provide a deep-dive investment report.

      Card Details:
      Title: ${card.title}
      Player: ${card.player}
      Year: ${card.year}
      Brand/Set: ${card.brand}
      Condition: ${card.condition || 'Unknown'}
      Current Market Value: $${card.currentMarketValue || 0}
      Estimated Grade: ${card.estimatedGrade || 'Raw'}

      Please provide an analysis covering:
      1. Grading ROI: Is it worth spending money to grade this card? Estimate the cost ($25-$40 usually) vs the potential % increase if it hits a PSA 9 or 10.
      2. Grade Probabilities: Based on the historical print quality of this specific year/set (e.g., 1989 Topps is often off-center, modern Prizm often has surface scratches), what is the realistic probability it hits a 10 vs a 9 or lower?
      3. Investment Outlook: What is the short-term and long-term outlook for this specific player/card combination?
      4. Historical Significance: Why is this specific card or set important? (e.g., Rookie card, iconic photo, overproduced junk wax era).

      Output JSON format:
      {
        "gradingRoi": {
          "isRecommended": boolean,
          "estimatedCost": number,
          "potentialValueIncreasePercent": number,
          "reasoning": "String explaining the ROI"
        },
        "gradeProbabilities": {
          "psa10_percent": number (0-100),
          "psa9_percent": number (0-100),
          "psa8_or_lower_percent": number (0-100),
          "commonConditionIssues": "String detailing era/set specific flaws"
        },
        "investmentOutlook": {
          "shortTerm": "Bearish" | "Neutral" | "Bullish",
          "longTerm": "Bearish" | "Neutral" | "Bullish",
          "riskLevel": "Low" | "Medium" | "High"
        },
        "historicalSignificance": "A paragraph explaining the importance of the card."
      }
    `;

        const response = await ai.generate({
            model: 'googleai/gemini-2.5-flash',
            prompt: prompt,
            output: { format: 'json' }
        });

        return response.output as any;
    }
);
