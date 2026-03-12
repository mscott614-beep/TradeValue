"use server";

import { ebayService } from "@/lib/ebay";
import { Portfolio } from "@/lib/types";
import { doc, updateDoc } from "firebase/firestore";
import { getFirestore } from "firebase-admin/firestore"; // Assuming we use admin for server actions or regular firestore if client-side compatible
// Wait, "use server" actions should probably use firebase-admin if updating firestore directly, 
// OR they can return the data and let the client update. 
// However, updating in the background is better.

import { revalidatePath } from "next/cache";

export async function refreshCardValueAction(userId: string, card: Portfolio) {
    try {
        // 1. Search eBay for active auctions
        // Ensure we include negative keywords for raw cards
        const isGraded = card.condition.includes('PSA') || card.condition.includes('BGS') || card.condition.includes('SGC') || !!card.grader;
        const searchQuery = `${card.year} ${card.brand} ${card.player} ${card.cardNumber} ${card.parallel || ''} ${isGraded ? card.condition : '-PSA -Graded -Slab'}`;
        
        const response = await ebayService.searchActiveAuctions(searchQuery, 10);
        const items = response.itemSummaries || [];

        if (items.length === 0) {
            return { success: false, error: "No active auctions found on eBay for this card." };
        }

        // 2. Calculate Median
        const prices = items
            .map(item => parseFloat(item.price.value))
            .filter(price => !isNaN(price))
            .sort((a, b) => a - b);

        let medianPrice = 0;
        if (prices.length > 0) {
            const mid = Math.floor(prices.length / 2);
            medianPrice = prices.length % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
        }

        // 3. Update Firestore (Using a placeholder for the update logic since I need to verify how firestore is initialized in actions)
        // For now, I'll return the results and the Top 5 listings.
        
        const top5 = items.slice(0, 5).map(item => ({
            title: item.title,
            price: parseFloat(item.price.value),
            url: item.itemWebUrl,
            imageUrl: item.image?.imageUrl,
            bidCount: item.bidCount
        }));

        return { 
            success: true, 
            newPrice: medianPrice, 
            top5,
            lastUpdated: new Date().toISOString()
        };
    } catch (error: any) {
        console.error("Failed to refresh card value:", error);
        return { success: false, error: error.message || "Failed to refresh market data" };
    }
}
