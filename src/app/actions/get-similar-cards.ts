"use server";

import { ebayService } from "@/lib/ebay";
import { Portfolio } from "@/lib/types";
import { isNoiseListing } from "@/lib/ebay-pricing";

export interface SimilarCard {
    title: string;
    price: number;
    url: string;
    imageUrl?: string;
    type: 'parallel' | 'player';
    listingType?: 'AUCTION' | 'FIXED_PRICE';
}

export async function getSimilarCardsAction(card: Portfolio) {
    try {
        const cleanCardNumber = (card.cardNumber || '').replace('#', '');
        
        // 1. Parallels Search: Same Year, Brand, Player, Number, but different parallel
        // We strip the current parallel if it exists
        const parallelsQuery = `${card.year} ${card.brand} ${card.player} ${cleanCardNumber}`.trim();
        
        // 2. Player Search: Other cards from different sets featuring the same player
        const playerQuery = `${card.player} trading card`.trim();

        const [parallelsRes, playerRes] = await Promise.all([
            ebayService.searchActiveItems(parallelsQuery, 6),
            ebayService.searchActiveItems(playerQuery, 6)
        ]);

        const parallels = (parallelsRes.itemSummaries || [])
            .filter(item => !item.title.toLowerCase().includes(card.title.toLowerCase())) // Try to avoid the exact same card
            .filter(item => !isNoiseListing(item.title)) // Filter out lots, u-pick, etc.
            .map(item => ({
                title: item.title,
                price: parseFloat(item.price.value),
                url: item.itemWebUrl,
                imageUrl: item.image?.imageUrl,
                type: 'parallel' as const,
                listingType: item.buyingOptions?.[0] as 'AUCTION' | 'FIXED_PRICE'
            }));

        const playerMatches = (playerRes.itemSummaries || [])
            .filter(item => !item.title.toLowerCase().includes(card.brand.toLowerCase())) // Filter out same brand to get "other sets"
            .filter(item => !isNoiseListing(item.title)) // Filter out lots, u-pick, etc.
            .map(item => ({
                title: item.title,
                price: parseFloat(item.price.value),
                url: item.itemWebUrl,
                imageUrl: item.image?.imageUrl,
                type: 'player' as const,
                listingType: item.buyingOptions?.[0] as 'AUCTION' | 'FIXED_PRICE'
            }));

        // Combine and de-duplicate by title (rough)
        const combined = [...parallels, ...playerMatches];
        const unique = combined.filter((v, i, a) => a.findIndex(t => t.title === v.title) === i);

        return { 
            success: true, 
            similarCards: unique.slice(0, 10) 
        };
    } catch (error: any) {
        console.error("Failed to fetch similar cards:", error);
        return { success: false, error: error.message || "Failed to fetch similar cards" };
    }
}
