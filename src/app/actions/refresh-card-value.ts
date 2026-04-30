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
    try {
        const agentUrl = (process.env.AGENT_SERVICE_URL || "").trim();
        if (!agentUrl) {
            throw new Error("AGENT_SERVICE_URL secret is not set.");
        }

        console.log(`[Refresh] Calling Python Agent for ${card.player}...`);
        
        const agentResponse = await fetch(`${agentUrl}/value-card`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                cardId: card.id,
                cardDetails: {
                    year: card.year || "",
                    brand: card.brand || "",
                    set: card.set || "",
                    player: card.player || "",
                    cardNumber: card.cardNumber || "",
                    parallel: card.parallel || "",
                    grade: card.condition || "",
                    gradingCompany: card.grader || ""
                }
            })
        });

        if (!agentResponse.ok) {
            throw new Error(`Agent returned ${agentResponse.status}: ${await agentResponse.text()}`);
        }

        const result = await agentResponse.json();
        const newPrice = typeof result.final_price === 'string' 
            ? parseFloat(result.final_price.replace(/[^0-9.]/g, "")) 
            : result.final_price;

        const research = result.research_results || {};
        const top5 = (research.top_listings || []).slice(0, 5).map((item: any) => ({
            title: item.title,
            price: item.price,
            url: item.url,
            imageUrl: item.image_url
        }));

        const activeItems = (research.top_listings || []).map((item: any) => ({
            title: item.title,
            price: item.price,
            url: item.url,
            imageUrl: item.image_url
        }));

        const soldItems = (research.sold_listings || []).map((item: any) => ({
            title: item.title,
            price: item.price,
            url: item.url,
            imageUrl: item.image_url,
            endDate: item.end_date
        }));

        const avgSoldPrice = research.avg_sold_price || 0;
        const lowVolumeData = research.low_volume || false;
        const timestamp = new Date().toISOString();

        console.log(`[Refresh] Agent Result: $${newPrice} via ${result.valuation_method}`);

        // Update Firestore
        const db = getAdminDb();
        const cardRef = db.doc(`users/${userId}/portfolios/${card.id}`);
        
        const marketPrices = {
            median: newPrice,
            activeItems,
            soldItems,
            avgSoldPrice,
            lowVolumeData,
            lastUpdated: timestamp
        };

        await cardRef.update({
            currentMarketValue: newPrice,
            lastMarketValueUpdate: timestamp,
            valuationMethod: result.valuation_method || "AGENT_MANUAL",
            lastSearchQuery: result.last_search_query || null,
            marketPrices
        });

        // Add to history
        const today = timestamp.split('T')[0];
        await cardRef.collection("priceHistory").doc(today).set({
            value: newPrice,
            timestamp: timestamp,
        }, { merge: true });

        return {
            success: true,
            value: newPrice,
            top5,
            diagnostics: `[Agent] Method: ${result.valuation_method} | Query: ${result.last_search_query}`
        };

    } catch (error: any) {
        console.error("[RefreshAction] Error:", error);
        return {
            success: false,
            error: error.message,
            diagnostics: error.stack
        };
    }
}
