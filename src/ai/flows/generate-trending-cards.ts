import { z } from 'zod';
import { ai } from '../genkit';
import { ebayService } from '@/lib/ebay';

export const TrendingCardSchema = z.object({
    id: z.string().describe('Unique ID, e.g. "t-1"'),
    player: z.string().describe('Player full name'),
    title: z.string().describe('Card title, e.g. "2015 Upper Deck Young Guns"'),
    change: z.string().describe('Percentage change string with sign, e.g. "+12.5%" or "-3.2%"'),
    value: z.string().describe('Formatted current market value, e.g. "$1,250"'),
    trend: z.enum(['up', 'down']).describe('"up" if positive change, "down" if negative'),
    reason: z.string().describe('One sentence explaining why this card is trending'),
});

export type TrendingCard = z.infer<typeof TrendingCardSchema>;

export const generateTrendingCards = ai.defineFlow(
    {
        name: 'generateTrendingCards',
        inputSchema: z.object({}),
        outputSchema: z.array(TrendingCardSchema),
    },
    async () => {
        // 1. Define typical high-volume players to check for trends
        const playersToWatch = ["Connor McDavid", "Victor Wembanyama", "Shohei Ohtani", "Auston Matthews"];
        
        // 2. Fetch "historical" data for these players
        // In a real app, this would iterate and find actual 'movers'.
        // For now, we fetch mock historical data from our service to demonstrate the pattern.
        const historicalContexts = await Promise.all(
            playersToWatch.slice(0, 2).map(async (player) => {
                const sales = await ebayService.getHistoricalSales(player);
                return { player, sales };
            })
        );

        const prompt = `
      You are a sports card market analyst. Analyze the provided historical sales data (if any) 
      and generate exactly 4 trending sports cards for this week.

      Historical Context (Simulated/Real):
      ${JSON.stringify(historicalContexts)}

      Requirements:
      - 3 should be trending UP (+5% to +30%)
      - 1 should be trending DOWN (-2% to -15%)
      - Use real, well-known players and real card sets
      - The "reason" must be a real-world market catalyst (e.g. playoff run, injury, trade).
      
      Return a valid JSON array of exactly 4 objects.
    `;

        const response = await ai.generate({
            model: 'googleai/gemini-3.1-flash-lite-preview',
            prompt,
            output: {
                schema: z.array(TrendingCardSchema),
            },
        });

        return response.output ?? [];
    }
);
