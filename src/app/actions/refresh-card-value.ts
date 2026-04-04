"use server";

import { ebayService } from "@/lib/ebay";
import { Portfolio } from "@/lib/types";
import { buildEbayQuery, calculateTradeValue } from "@/lib/ebay-pricing";
import { getAdminDb } from "@/lib/firebase-server";

/**
 * Refreshes the card value using the Lead Data Architect Specification.
 * Ground Truth: MARKET_ENGINE_SPEC.md
 * Phase: Production Engine v1.2
 */
export async function refreshCardValueAction(userId: string, card: Portfolio) {
    try {
        // 1. Classification and Initial Query Construction (Step 1 & 2)
        const { type, query: primaryQuery } = buildEbayQuery({
            year: card.year,
            brand: card.brand,
            set: card.set,
            player: card.player,
            cardNumber: card.cardNumber,
            parallel: card.parallel,
            title: card.title,
            condition: card.condition // Added to support graded card pricing
        });

        // 2. Step 3: API Request Configuration (FIXED_PRICE Priority / EXTENDED Fields)
        console.log(`[Refresh] Lead Data Architect Query (${type}): "${primaryQuery}"`);

        let usedQuery = primaryQuery;
        let activeResponse = await ebayService.searchActiveItems(primaryQuery, 10);
        let rawItems = activeResponse.itemSummaries || [];

        // Self-Healing Logic: Try a broader query if the ultra-precise one fails.
        // Stage 2: Remove the "parallel" but keep the Card Number (the unique ID) for precision.
        if (rawItems.length === 0) {
            const set = card.set || '';
            const cleanNum = (card.cardNumber || '').toString().replace('#', '').trim();
            const formattedNum = cleanNum.match(/^\d+$/) ? `#${cleanNum}` : cleanNum;
            const secondaryQuery = `${card.year} ${card.brand} ${set} ${card.player} ${formattedNum} -reprint -digital`.replace(/\s+/g, ' ').trim();
            
            console.log(`[Refresh] Primary failed ($0). Trying Stage 2 (No Parallel): "${secondaryQuery}"`);
            usedQuery = secondaryQuery;
            activeResponse = await ebayService.searchActiveItems(secondaryQuery, 10);
            rawItems = activeResponse.itemSummaries || [];
        }

        // Stage 3: If Stage 2 fails, remove the "Set" too. Rely entirely on Year, Player, and Card Number.
        if (rawItems.length === 0) {
            const cleanNum = (card.cardNumber || '').toString().replace('#', '').trim();
            const formattedNum = cleanNum.match(/^\d+$/) ? `#${cleanNum}` : cleanNum;
            const tertiaryQuery = `${card.year} ${card.brand} ${card.player} ${formattedNum} -reprint -digital`.replace(/\s+/g, ' ').trim();
            
            console.log(`[Refresh] Stage 2 failed ($0). Trying Stage 3 (Identifier Only): "${tertiaryQuery}"`);
            usedQuery = tertiaryQuery;
            activeResponse = await ebayService.searchActiveItems(tertiaryQuery, 10);
            rawItems = activeResponse.itemSummaries || [];
        }

        console.log(`[Refresh] Found ${rawItems.length} matching items on eBay using: "${usedQuery}"`);

        // 3. Step 4: Value Calculation (The TradeValue Rule - 3 Lowest Median)
        const calc = calculateTradeValue(rawItems);

        // 4. Atomic Authorized Update (Admin SDK - Permissions Fix)
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

        const querySource = usedQuery === primaryQuery ? 'Primary' : 'Fallback';
        const diagnostics = `[${querySource}] Query: "${usedQuery}" | Found: ${rawItems.length} | CalcPrice: ${calc.value}`;
        console.log(`[Refresh] Final Diagnostic: ${diagnostics}`);

        return {
            success: true,
            newPrice: calc.value,
            avgActivePrice: calc.value,
            avgSoldPrice: 0,
            diagnostics,
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
