import { z } from 'zod';
import { ai, generateWithFallback, PRIMARY_MODEL } from '../genkit';
import { ebayService } from '@/lib/ebay';

export const AuctionListingSchema = z.object({
    id: z.string().describe('Unique identifier'),
    title: z.string().describe('Full card title'),
    player: z.string().describe('Player name'),
    year: z.string().describe('Card year'),
    brand: z.string().describe('Card brand'),
    condition: z.string().describe('Grade or condition'),
    currentBid: z.number().describe('Current highest bid in USD'),
    bids: z.number().describe('Total number of bids'),
    timeLeft: z.string().describe('Time remaining'),
    imageHint: z.string().describe('Short description for image generator or placeholder'),
    sport: z.string().describe('Sport'),
    url: z.string().optional().describe('eBay listing URL'),
    imageUrl: z.string().optional().describe('Direct image URL'),
});

export type AuctionListing = z.infer<typeof AuctionListingSchema>;

export const generateLiveAuctionsInputSchema = z.object({
    topic: z.string().optional().describe('Search term for auctions.'),
});

export const generateLiveAuctions = ai.defineFlow(
    {
        name: 'generateLiveAuctions',
        inputSchema: generateLiveAuctionsInputSchema,
        outputSchema: z.array(AuctionListingSchema),
    },
    async (input) => {
        const query = input.topic || "sports trading cards PSA 10";
        
        try {
            // 1. Fetch real data from eBay - Search ALL listings to get best images and prices
            const ebayResults = await ebayService.searchActiveItems(query, 4, 'price', true);
            const rawItems = ebayResults.itemSummaries || [];

            if (rawItems.length === 0) {
                // Fallback to simulation if no results found
                console.warn(`No eBay results found for "${query}". Falling back to simulation.`);
            } else {
                // 2. Use AI to standardize and enhance the real eBay data
                const prompt = `
                  I have raw sports card data from eBay. 
                  Standardize this data into a consistent JSON array of exactly ${rawItems.length} objects.
                  Extract the player name, year, and brand from the titles. 
                  Estimate the sport if not explicit.
                  
                  Raw Data:
                  ${JSON.stringify(rawItems)}
                `;

                const response = await generateWithFallback({
                    prompt,
                    model: PRIMARY_MODEL,
                    output: {
                        schema: z.array(AuctionListingSchema),
                    },
                });

                // Map back the URLs and IDs from the real API to the AI's standardized objects
                return (response.output || []).map((item: AuctionListing, idx: number) => ({
                    ...item,
                    id: rawItems[idx].itemId,
                    url: rawItems[idx].itemWebUrl,
                    imageUrl: rawItems[idx].image?.imageUrl,
                }));
            }
        } catch (error) {
            console.error("eBay Integration Error:", error);
            // Fallthrough to simulation if API fails entirely
        }

        // --- SIMULATION FALLBACK (original logic for robustness) ---
        try {
            const prompt = `
              You are a sports card analyst. eBay API is currently unavailable.
              Generate exactly 4 realistic, PLAUSIBLE live auction listings for ${query}.
              Include player, title, year, brand, condition, currentBid, bids, and timeLeft.
            `;

            const response = await generateWithFallback({
                model: PRIMARY_MODEL,
                prompt,
                output: {
                    schema: z.array(AuctionListingSchema),
                },
            });

            return (response.output ?? []).map((item: any) => ({
                ...item,
                imageUrl: `https://images.unsplash.com/photo-1594913785162-e678508246a4?q=80&w=400&h=400&auto=format&fit=crop`,
            }));
        } catch (simError) {
            console.error("Simulation Fallback Error:", simError);
            return []; // Final safe return to prevent UI hang
        }
    }
);
