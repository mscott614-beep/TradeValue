import { genkit } from 'genkit';
import { z } from 'zod';
import { ai } from '../genkit';
import { AlertConfig, Portfolio } from '@/lib/types';

export const runMarketScannerSchema = z.object({
    cards: z.array(z.any()), // Portfolio[]
    alertsConfig: z.array(z.any()), // AlertConfig[]
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
        const { cards, alertsConfig } = input;

        // Safety check - if no cards or no configs, return empty 
        // (though in reality, we might still want to generate generic red flags even w/o configs)
        if (!cards || cards.length === 0) {
            return { alerts: [] };
        }

        const cardsSummary = cards.map((c: Portfolio) =>
            `ID:${c.id} | ${c.year} ${c.brand} ${c.player} (${c.condition}) - Value: $${c.currentMarketValue}`
        ).join('\n');

        const configSummary = alertsConfig.map((ac: AlertConfig) =>
            `Target: ${ac.targetType}=${ac.targetValue} | Condition: ${ac.condition} | Threshold: ${ac.threshold}`
        ).join('\n');

        const prompt = `
      You are an automated, high-frequency AI market watchdog for a sports card portfolio. 
      You have access to a user's current Portfolio and their custom Alert Rules.

      Portfolio:
      ${cardsSummary}

      Active User Alert Rules:
      ${configSummary || "No custom rules set."}

      Your task is to analyze current (simulated) market conditions against this portfolio and these rules.
      Since we don't have live external data right now, simulate realistic market shifts that might have happened today.

      Generate a set of ALERTS based on the following criteria:
      1. Triggered Custom Rules: If a simulated market shift triggers one of the user's rules, generate an alert.
         - e.g., If rule is "Connor McDavid drops below 500" and you simulate a market dip for him, generate a 'drop' alert.
      2. Generic Red Flags: Identify concerning broader market trends affecting their cards (e.g., "Junk Wax era volume dumping").
      3. Optimal Sell: Identify cards in the portfolio that have hit historical simulated peaks today.

      Output JSON format:
      {
        "alerts": [
          {
             "type": "rise" | "drop" | "optimal_sell" | "red_flag",
             "title": "Short catchy title",
             "message": "Detailed explanation of the market movement and why it triggered",
             "relatedCardId": "ID of the specific card affected (if applicable)"
          }
        ]
      }
      
      Limit to 3-5 of the most important, realistic alerts.
    `;

        const response = await ai.generate({
            // Use 2.5 flash as it is our stable default that avoids the 2.0 quota limits
            model: 'googleai/gemini-2.5-flash',
            prompt: prompt,
            output: { format: 'json' }
        });

        return response.output as any;
    }
);
