import { z } from 'zod';
import { ai, generateWithFallback, PRIMARY_MODEL } from '../genkit';
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
        // 1. Expanded player pool for variety
        const playerPool = [
            "Connor McDavid", "Auston Matthews", "Nathan MacKinnon", "Cale Makar", "Connor Bedard",
            "Sidney Crosby", "Alex Ovechkin", "Igor Shesterkin", "Tage Thompson", "Jack Hughes",
            "Victor Wembanyama", "LeBron James", "Stephen Curry", "Luka Doncic", "Giannis Antetokounmpo",
            "Jayson Tatum", "Shai Gilgeous-Alexander", "Anthony Edwards", "Ja Morant", "Nikola Jokic",
            "Shohei Ohtani", "Aaron Judge", "Ronald Acuna Jr.", "Mookie Betts", "Juan Soto",
            "Elly De La Cruz", "Corbin Carroll", "Mike Trout", "Julio Rodriguez", "Bobby Witt Jr.",
            "Patrick Mahomes", "Joe Burrow", "Josh Allen", "Justin Jefferson", "Tyreek Hill",
            "Lamar Jackson", "C.J. Stroud", "Brock Purdy", "Christian McCaffrey", "Travis Kelce"
        ];

        // 2. Randomly sample 8 players to find potential "movers"
        const shuffled = [...playerPool].sort(() => 0.5 - Math.random());
        const selectedPlayers = shuffled.slice(0, 8);

        // 3. Fetch real-time market volume (active listing count) for these players
        const marketIntelligence = await Promise.all(
            selectedPlayers.map(async (player) => {
                try {
                    const results = await ebayService.searchActiveItems(player, 1);
                    return {
                        player,
                        activeListingCount: results.total || 0,
                        lastChecked: new Date().toISOString()
                    };
                } catch (error) {
                    return { player, activeListingCount: "unavailable", lastChecked: new Date().toISOString() };
                }
            })
        );

        const prompt = `
      You are a sports card market analyst at TradeValue. Analyze the provided real-time market liquidity 
      indicators (active listing counts) and generate exactly 4 trending sports cards for this week.

      Today's Date: ${new Date().toLocaleDateString()}
      
      Market Intelligence (Current Active Volume):
      ${JSON.stringify(marketIntelligence)}

      Requirements:
      - Select exactly 4 cards from the provided list of players or closely related star athletes.
      - 3 cards should be trending UP (+5% to +40%)
      - 1 card should be trending DOWN (-3% to -20%)
      - Ensure the "reason" is specific to current (simulated or real) market catalysts like 
        standout performances, playoff positioning, injuries, or significant card set releases.
      - **CRITICAL**: Do Not return the same 4 cards every time. Use the variety in the input 
        to ensure different players are featured each week.
      
      Return a valid JSON array of exactly 4 objects.
    `;

        const response = await generateWithFallback({
            model: PRIMARY_MODEL,
            prompt,
            output: {
                schema: z.array(TrendingCardSchema),
            },
        });

        return response.output ?? [];
    }
);
