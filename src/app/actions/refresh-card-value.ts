"use server";

import { ebayService } from "@/lib/ebay";
import { Portfolio } from "@/lib/types";
import { buildEbayQuery, calculateTradeValue } from "@/lib/ebay-pricing";
import { getAdminDb } from "@/lib/firebase-server";

/**
 * Refreshes the card value using a simple, broad eBay search.
 * [Hybrid Revert Build: Admin SDK Infrastructure + Simple Search Logic]
 */
export async function refreshCardValueAction(userId: string, card: Portfolio) {
    try {
        // 1. Build a simple, broad query
        const { type, query } = buildEbayQuery({
            year: card.year,
            brand: card.brand,
            player: card.player,
            cardNumber: card.cardNumber,
            parallel: card.parallel,
            title: card.title
        });

        console.log(`[Refresh] Simple Query (${type}): "${query}"`);
        
        // 2. Fetch from eBay (Limit to 10 for speed)
        const activeResponse = await ebayService.searchActiveItems(query, 10);
        const rawItems = activeResponse.itemSummaries || [];
        
        console.log(`[Refresh] Found ${rawItems.length} items on eBay.`);

        // 3. Simple Calculation
        const calc = calculateTradeValue(rawItems);

        // 4. Atomic Authorized Update (Admin SDK)
        const db = getAdminDb();
        const timestamp = new Date().toISOString();
        
        // Update the card reference
        const cardRef = db.doc(`users/${userId}/portfolios/${card.id}`);
        await cardRef.update({
            currentMarketValue: calc.value,
            lastChecked: timestamp,
            status: 'success'
        });

        // Update the price history
        const historyRef = db.collection(`users/${userId}/portfolios/${card.id}/priceHistory`).doc(timestamp.split('T')[0]);
        await historyRef.set({
            value: calc.value,
            timestamp: timestamp
        });

        return { 
            success: true, 
            newPrice: calc.value, 
            avgActivePrice: calc.value,
            avgSoldPrice: 0, 
            top5: rawItems.map(item => ({
                title: item.title,
                price: parseFloat(item.price.value),
                url: item.itemWebUrl,
                imageUrl: item.image?.imageUrl,
            })),
            soldItems: [], 
            lastUpdated: timestamp,
            searchType: type,
            logic: calc.logic
        };
    } catch (error: any) {
        console.error("Failed to refresh card value:", error);
        return { success: false, error: error.message || "Failed to refresh market data" };
    }
}
