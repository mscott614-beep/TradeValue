"use server";

import { ebayService } from "@/lib/ebay";
import { Portfolio } from "@/lib/types";
import { buildEbayQuery, calculateTradeValue, GENERIC_SET_STOPWORDS } from "@/lib/ebay-pricing";
import { getAdminDb } from "@/lib/firebase-server";

/**
 * Refreshes the card value using the Lead Data Architect Specification.
 * Ground Truth: MARKET_ENGINE_SPEC.md
 * Phase: Production Engine v1.2
 */
export async function refreshCardValueAction(userId: string, card: Portfolio) {
    let diagnostics = '';
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

        // Stage 2 (Variant Broad): Try without the brand name for maximum findability.
        // This targets listings like "2017-18 Ultimate Collection Tage Thompson Rookie Debut"
        if (rawItems.length === 0 && (card.parallel || card.set)) {
            const set = card.set && !GENERIC_SET_STOPWORDS.includes(card.set.toLowerCase()) ? card.set : '';
            const variantQuery = `${card.year} ${set} ${card.player} ${card.parallel || ''} -reprint -digital`.replace(/\s+/g, ' ').trim();

            console.log(`[Refresh] Primary failed ($0). Trying Stage 2 (Broad): "${variantQuery}"`);
            usedQuery = variantQuery;
            activeResponse = await ebayService.searchActiveItems(variantQuery, 10);
        }

        // Stage 2.1 (Market-Proven): If Set-based search fails, try without the Set name.
        // This mirrors exactly what the user found works: "2017-18 Upper Deck Tage Thompson rookie debut"
        if (rawItems.length === 0 && card.parallel) {
            const marketQuery = `${card.year} ${card.brand || ''} ${card.player} ${card.parallel} -reprint -digital`.replace(/\s+/g, ' ').trim();
            console.log(`[Refresh] Stage 2 failed ($0). Trying Stage 2.1 (Market-Proven): "${marketQuery}"`);
            usedQuery = marketQuery;
            activeResponse = await ebayService.searchActiveItems(marketQuery, 10);
            rawItems = activeResponse.itemSummaries || [];
        }

        // Stage 3 (Identifier-First): If Variant search fails, try the Card Number but DROP the Parallel.
        // This targets base-card listings for non-parallel versions.
        if (rawItems.length === 0) {
            const cleanNum = (card.cardNumber || '').toString().replace('#', '').trim();
            const formattedNum = cleanNum.match(/^\d+$/) ? `#${cleanNum}` : cleanNum;
            const identifierQuery = `${card.year} ${card.brand} ${card.player} ${formattedNum} -reprint -digital`.replace(/\s+/g, ' ').trim();

            console.log(`[Refresh] Stage 2 failed ($0). Trying Stage 3 (Identifier-First): "${identifierQuery}"`);
            usedQuery = identifierQuery;
            activeResponse = await ebayService.searchActiveItems(identifierQuery, 10);
            rawItems = activeResponse.itemSummaries || [];
        }

        // Stage 4 (Nuclear Fallback): Inject critical keywords (Auto, Patch, Jersey, Rookie).
        if (rawItems.length === 0) {
            const features = [
                card.parallel || '',
                ...(card.features || []),
                card.title || ''
            ].join(' ').toLowerCase();

            let keywords = '';
            if (features.includes('auto') || features.includes('signature')) keywords += ' auto';
            if (features.includes('patch') || features.includes('threads')) keywords += ' patch';
            if (features.includes('jersey') || features.includes('relic') || features.includes('memo')) keywords += ' jersey';
            if (features.includes('rookie') || features.includes('debut')) keywords += ' rookie';

            // IMPORTANT: Removed card.brand from Nuclear fallback to handle generic titles
            const nuclearQuery = `${card.year} ${card.set || ''} ${card.player}${keywords} -reprint -digital`.replace(/\s+/g, ' ').trim();

            console.log(`[Refresh] Stage 3 failed ($0). Trying Stage 4 (Nuclear): "${nuclearQuery}"`);
            usedQuery = nuclearQuery;
            activeResponse = await ebayService.searchActiveItems(nuclearQuery, 10);
            rawItems = activeResponse.itemSummaries || [];
        }

        console.log(`[Refresh] Found ${rawItems.length} matching items on eBay using: "${usedQuery}"`);

        // 3. Step 4: Value Calculation (The TradeValue Rule - 3 Lowest Median)
        const calc = calculateTradeValue(rawItems);

        // 4. Calculate 24h changes & Update Firestore (Optional/Resilient for local verification)
        const timestamp = new Date().toISOString();
        const today = timestamp.split('T')[0];
        let valueChange24h = 0;
        let valueChange24hPercent = 0;

        try {
            const db = getAdminDb();
            const yesterdayDate = new Date();
            yesterdayDate.setDate(yesterdayDate.getDate() - 1);
            const yesterday = yesterdayDate.toISOString().split('T')[0];

            // Fetch yesterday's value from priceHistory
            const cardRef = db.doc(`users/${userId}/portfolios/${card.id}`);
            const yesterdaySnap = await cardRef.collection("priceHistory").doc(yesterday).get();

            if (yesterdaySnap.exists) {
                const yesterdayValue = yesterdaySnap.data()?.value;
                if (typeof yesterdayValue === "number" && yesterdayValue > 0) {
                    valueChange24h = calc.value - yesterdayValue;
                    valueChange24hPercent = Math.round((valueChange24h / yesterdayValue) * 100 * 100) / 100;
                }
            } else if (typeof card.currentMarketValue === "number" && card.currentMarketValue > 0) {
                // Fallback: If no yesterday's snapshot, compare with currentMarketValue
                valueChange24h = calc.value - card.currentMarketValue;
            }
        } catch (dbError) {
            console.warn("[Refresh] Firestore yesterday values fetch failed:", dbError);
        }

        // 5. Fetch 5 Recent Sales (Comps)
        let soldItems: any[] = [];
        let avgSoldPrice = 0;
        let lowVolumeData = false;

        try {
            const soldResponse = await ebayService.searchSoldItems({
                cardTitle: usedQuery, // Use the successful query for better matching
                epid: card.epid,
                upc: card.upc,
                limit: 5
            });

            const rawSoldItems = soldResponse.itemSummaries || [];
            lowVolumeData = rawSoldItems.length < 5;

            const querySource = usedQuery === primaryQuery ? 'Primary' : 'Fallback';
            const diagnostics = `[${querySource}] Query: "${usedQuery}" | Found: ${rawItems.length} | CalcPrice: ${calc.value}`;
            console.log(`[Refresh] Final Diagnostic: ${diagnostics}`);

            soldItems = rawSoldItems.map(item => ({
                title: item.title,
                price: parseFloat(item.price.value) + parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0'),
                url: item.itemWebUrl,
                imageUrl: item.image?.imageUrl,
                endDate: item.itemEndDate || item.itemCreationDate
            }));

            if (soldItems.length > 0) {
                const total = soldItems.reduce((acc, item) => acc + item.price, 0);
                avgSoldPrice = total / soldItems.length;
            }
        } catch (soldError) {
            console.error("[Refresh] Failed to fetch sold items:", soldError);
        }

        // 6. Update the card in Firestore (Optional/Resilient for local verification)
        try {
            const db = getAdminDb();
            const yesterdayDate = new Date();
            yesterdayDate.setDate(yesterdayDate.getDate() - 1);
            const yesterday = yesterdayDate.toISOString().split('T')[0];

            // Fetch yesterday's value from priceHistory
            const cardRef = db.doc(`users/${userId}/portfolios/${card.id}`);
            const yesterdaySnap = await cardRef.collection("priceHistory").doc(yesterday).get();

            if (yesterdaySnap.exists) {
                const yesterdayValue = yesterdaySnap.data()?.value;
                if (typeof yesterdayValue === "number" && yesterdayValue > 0) {
                    valueChange24h = calc.value - yesterdayValue;
                    valueChange24hPercent = Math.round((valueChange24h / yesterdayValue) * 100 * 100) / 100;
                }
            } else if (typeof card.currentMarketValue === "number" && card.currentMarketValue > 0) {
                // Fallback: If no yesterday's snapshot, compare with currentMarketValue
                valueChange24h = calc.value - card.currentMarketValue;
                valueChange24hPercent = Math.round((valueChange24h / card.currentMarketValue) * 100 * 100) / 100;
            }

            // Map active items to harmonized format for UI
            const activeItems = rawItems.slice(0, 10).map(item => ({
                title: item.title,
                price: parseFloat(item.price?.value || '0') + parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0'),
                url: item.itemWebUrl,
                imageUrl: item.image?.imageUrl
            }));

            // Update the card reference with new value and metrics
            await cardRef.update({
                currentMarketValue: calc.value,
                valueChange24h,
                valueChange24hPercent,
                lastMarketValueUpdate: timestamp,
                marketPrices: {
                    median: calc.value,
                    activeItems: activeItems,
                    soldItems: soldItems,
                    avgSoldPrice,
                    lowVolumeData,
                    lastUpdated: timestamp
                },
                status: 'success'
            });

            // Update the price history for today
            const historyRef = cardRef.collection("priceHistory").doc(today);
            await historyRef.set({
                value: calc.value,
                timestamp: timestamp
            }, { merge: true });
        } catch (dbError) {
            console.warn("[Refresh] Firestore interaction failed (expected in local dev):", dbError);
        }

        return {
            success: true,
            newPrice: calc.value,
            avgActivePrice: calc.value,
            avgSoldPrice,
            lowVolumeData,
            diagnostics,
            top5: rawItems.map(item => ({
                title: item.title,
                price: parseFloat(item.price.value) + parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0'),
                url: item.itemWebUrl,
                imageUrl: item.image?.imageUrl,
            })),
            soldItems,
            lastUpdated: timestamp,
            searchType: type,
            logic: calc.logic
        };
    } catch (error: any) {
        console.error("Failed to refresh card value:", error);
        return { success: false, error: error.message || "Failed to refresh market data" };
    }
}
