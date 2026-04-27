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
          You are a sports card market analyst. Analyze the provided real-time market liquidity indicators and generate exactly 4 trending sports cards.

          Market Intelligence Data:
          ${JSON.stringify(marketIntelligence)}

          Instructions:
          1. Choose exactly 4 different players from the intelligence data.
          2. Set 3 cards to trend "up" and 1 card to trend "down" based on liquidity and player popularity.
          3. For each card, provide:
             - id: A unique string like "t-1", "t-2", etc.
             - player: Full name.
             - title: A specific card title (e.g. "2023-24 Prizm Silver Refractor").
             - change: A realistic percentage change (e.g. "+15.2%").
             - value: A realistic market price (e.g. "$450").
             - trend: "up" or "down".
             - reason: A concise, data-backed one-sentence explanation.
          4. Return ONLY a valid JSON array of 4 objects. No conversational text.
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
