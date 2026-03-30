"use server";

import { ebayService } from "@/lib/ebay";
import { Portfolio } from "@/lib/types";
import { buildEbayQuery, calculateTradeValue } from "@/lib/ebay-pricing";
import { getAdminDb } from "@/lib/firebase-server";

export async function refreshCardValueAction(userId: string, card: Portfolio) {
    try {
        // 1. Classification and Initial Query Construction
        const { type, query: primaryQuery } = buildEbayQuery({
            year: card.year,
            brand: card.brand,
            player: card.player,
            cardNumber: card.cardNumber,
            parallel: card.parallel,
            title: card.title
        });

        const isChecklist = card.title?.toLowerCase().includes('checklist') || 
                            (card.player || '').toLowerCase().includes('checklist');
        
        // Expanded exclusions to catch noise from AHL, Portraits, and Graded variants
        const EXCLUSIONS = ' -checklist -u-pick -upick -choice -pick -lot -choose -collection -wholesale -portrait -ahl -glossy -sticker -non-auto -rp';

        let finalQuery = primaryQuery;
        if (!isChecklist && !finalQuery.includes('-checklist')) {
            finalQuery += EXCLUSIONS;
        }

        console.log(`[Refresh] Query (${type}): "${finalQuery}"`);
        let activeResponse = await ebayService.searchActiveItems(finalQuery, 10);
        let rawItems = activeResponse.itemSummaries || [];
        console.log(`[Refresh] eBay Tier 1 results: ${rawItems.length}`);

        // 2. Soft Query Fallback (Tier 2): Player + Parallel + Number (Removes Year/Brand noise)
        if (rawItems.length === 0) {
            const cleanNumber = (card.cardNumber || '').replace('#', '');
            const parallelStr = card.parallel && card.parallel.toLowerCase() !== 'base' ? card.parallel : '';
            let softQuery = `${card.player} ${parallelStr} ${cleanNumber}`.trim();
            if (!isChecklist) softQuery += EXCLUSIONS;
            
            console.log(`[Refresh] Tier 1 failed. Trying Tier 2 Soft Fallback: "${softQuery}"`);
            activeResponse = await ebayService.searchActiveItems(softQuery, 10);
            rawItems = activeResponse.itemSummaries || [];
            console.log(`[Refresh] eBay Tier 2 results: ${rawItems.length}`);
        }

        // 3. Post-Fetch Filter: Eliminate misidentified subsets
        // If we are looking for Young Guns, the result title *must* contain "Young Guns"
        const combinedSpec = `${card.parallel || ''} ${card.title || ''}`.toLowerCase();
        const needsYoungGuns = combinedSpec.includes('young guns');
        const needsJumbo = combinedSpec.includes('jumbo');
        const needsGlossy = combinedSpec.includes('glossy');

        if (rawItems.length > 0) {
            const initialCount = rawItems.length;
            const filteredItems = rawItems.filter(item => {
                const title = item.title.toLowerCase();
                if (needsYoungGuns && !title.includes('young guns')) return false;
                if (needsJumbo && !title.includes('jumbo')) return false;
                if (needsGlossy && !title.includes('glossy')) return false;
                
                // If it's a base search, explicitly exclude the big features
                if (!needsYoungGuns && title.includes('young guns')) return false;
                if (!needsJumbo && title.includes('jumbo')) return false;

                return true;
            });

            // Self-Healing Logic: If filtering zeroed us out, keep the originals to avoid $0.00
            if (filteredItems.length === 0 && initialCount > 0) {
                console.warn(`[Refresh] Subset filter zeroed results. Reverting to unfiltered set (${initialCount} items) to ensure valuation.`);
            } else {
                rawItems = filteredItems;
                if (rawItems.length < initialCount) {
                    console.log(`[Refresh] Filtered out ${initialCount - rawItems.length} misidentified listings (Subset mismatch).`);
                }
            }
        }

        // 4. Calculate TradeValue using the "Floor Median" Rule
        const calc = calculateTradeValue(rawItems);

        // 5. Atomic Authorized Update (Admin SDK)
        // This bypasses client-side security rules to ensure persistence
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
            top5: rawItems.slice(0, 10).map(item => ({
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
