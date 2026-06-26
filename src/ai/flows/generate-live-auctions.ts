import { z } from 'zod';
import { ai, generateWithFallback, PRIMARY_MODEL } from '../genkit';
import { ebayService } from '@/lib/ebay';
import { mapEbayItemsToAuctions } from '@/lib/market-fallbacks';

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
            // 1. Fetch real auction data from eBay
            const ebayResults = await ebayService.searchActiveAuctions(query, 4);
            const rawItems = ebayResults.itemSummaries || [];

            if (rawItems.length === 0) {
                console.warn(`No eBay auction results found for "${query}". Falling back to simulation.`);
            } else {
                try {
                    const prompt = `
                  You are a sports card data expert. Standardize the following eBay sports card data into a valid JSON array matching the required schema.
                  
                  Required Fields for each item:
                  - id: Use the eBay itemId.
                  - title: The full card title.
                  - player: The player's full name.
                  - year: The card's production year.
                  - brand: The brand (e.g. Topps, Upper Deck, Panini).
                  - condition: The grade or condition (e.g. PSA 10, Raw).
                  - currentBid: The current price value as a number.
                  - bids: Number of bids (use 0 if not provided).
                  - timeLeft: Time remaining (e.g. "2h 15m").
                  - imageHint: A short visual description of the card.
                  - sport: The sport (e.g. Hockey, Basketball).
                  
                  Raw eBay Data:
                  ${JSON.stringify(rawItems)}
                  
                  CRITICAL: Return EXACTLY a JSON array of objects. Do not omit any fields.
                `;

                    const response = await generateWithFallback({
                        prompt,
                        output: {
                            schema: z.array(AuctionListingSchema),
                        },
                        timeout: 25000,
                    } as any);

                    return (response.output || []).map((item: AuctionListing, idx: number) => {
                        const raw = rawItems[idx] || {};
                        return {
                            ...item,
                            id: raw.itemId || item.id,
                            url: raw.itemWebUrl || item.url,
                            imageUrl: raw.image?.imageUrl || item.imageUrl,
                        };
                    });
                } catch (aiError) {
                    console.warn(
                        "[Auctions] Gemini unavailable, using direct eBay mapping:",
                        aiError
                    );
                    const mapped = mapEbayItemsToAuctions(ebayResults, query);
                    if (mapped.length > 0) {
                        return mapped;
                    }
                    throw aiError;
                }
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
              
              Required Fields for each item:
              - id: A unique string like "sim-1".
              - title: Full card title.
              - player: Player full name.
              - year: Card year.
              - brand: Card brand.
              - condition: Grade/condition.
              - currentBid: Number.
              - bids: Number.
              - timeLeft: String (e.g. "45m").
              - imageHint: Brief description.
              - sport: Sport name.
              
              Return ONLY a valid JSON array of 4 objects.
            `;

            const response = await generateWithFallback({
                prompt,
                output: {
                    schema: z.array(AuctionListingSchema),
                },
                timeout: 25000,
            } as any);

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
