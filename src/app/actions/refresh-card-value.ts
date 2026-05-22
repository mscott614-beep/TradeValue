"use server";

import { ebayService } from "@/lib/ebay";
import { Portfolio } from "@/lib/types";
import { buildEbayQuery, calculateTradeValue, GENERIC_SET_STOPWORDS } from "@/lib/ebay-pricing";
import { getAdminDb } from "@/lib/firebase-server";
import { resolveAgentServiceUrl } from "@/lib/resolve-agent-service-url";
import { normalizeHockeyCardYear } from "@/lib/hockey-card-year";

/**
 * Refreshes the card value using the Lead Data Architect Specification.
 * Ground Truth: MARKET_ENGINE_SPEC.md
 * Phase: Production Engine v1.2
 */
export async function refreshCardValueAction(userId: string, card: Portfolio) {
    try {
        const agentUrl = resolveAgentServiceUrl("valuation");
        console.log(`[Refresh] Targeting Agent at: ${agentUrl}/value-card`);

        const yearFix = normalizeHockeyCardYear({
            year: card.year,
            brand: card.brand,
            player: card.player,
            cardNumber: card.cardNumber,
            set: card.set,
        });
        const scanYear = yearFix.corrected ? yearFix.year : (card.year || "");

        console.log(`[Refresh] Calling Python Agent for ${card.player} (${scanYear})...`);
        
        const agentResponse = await fetch(`${agentUrl}/value-card`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                cardId: card.id,
                cardDetails: {
                    year: scanYear,
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
        let newPrice = typeof result.final_price === 'string' 
            ? parseFloat(result.final_price.replace(/[^0-9.]/g, "")) 
            : result.final_price;
            
        // Safety: Fallback if price is missing or invalid
        if (newPrice === undefined || newPrice === null || isNaN(Number(newPrice))) {
            console.warn("[Refresh] Agent returned invalid price:", result.final_price);
            newPrice = card.currentMarketValue || 0; 
        }

        const top5 = (result.active_listings || []).slice(0, 5).map((item: any) => ({
            title: item.title,
            price: item.price,
            url: item.url,
            imageUrl: item.image_url
        }));
        
        const activeItems = (result.active_listings || []).map((item: any) => ({
            title: String(item.title || "No Title"),
            price: Number(item.price || 0),
            url: String(item.url || "#"),
            imageUrl: item.image_url || item.imageUrl || null
        }));

        const soldItems = (result.sold_listings || []).map((item: any) => ({
            title: String(item.title || "No Title"),
            price: Number(item.price || 0),
            url: String(item.url || "#"),
            imageUrl: item.image_url || item.imageUrl || null,
            endDate: String(item.endDate || item.end_date || new Date().toISOString().split('T')[0])
        }));

        const avgSoldPrice = result.avg_sold_price || 0;
        const lowVolumeData = result.low_volume || false;
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

        const avgActivePrice = activeItems.length > 0 
            ? activeItems.reduce((acc: number, item: any) => {
                const p = typeof item.price === 'number' ? item.price : parseFloat(String(item.price).replace(/[^0-9.]/g, ""));
                return acc + (isNaN(p) ? 0 : p);
            }, 0) / activeItems.length 
            : 0;

        return {
            success: true,
            newPrice,
            top5,
            soldItems,
            avgActivePrice,
            avgSoldPrice,
            lowVolumeData,
            diagnostics: `[Agent] Method: ${result.method || result.valuation_method || "direct_search"} | Query: ${result.query || result.last_search_query || "Manual Search Required"}`
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

export async function analyzeCardAction(card: Portfolio) {
    try {
        const agentUrl = resolveAgentServiceUrl("analysis");
        console.log(`[Analysis] Targeting Agent at: ${agentUrl}/analyze-card`);

        const yearFix = normalizeHockeyCardYear({
            year: card.year,
            brand: card.brand,
            player: card.player,
            cardNumber: card.cardNumber,
            set: card.set,
        });

        if (yearFix.corrected) {
            console.warn(
                `[Analysis] Hockey year normalized: "${card.year}" → "${yearFix.year}" (${yearFix.reason})`
            );
        }

        const cleanedCard = {
            id: card.id,
            title: card.title,
            player: card.player,
            year: yearFix.year,
            brand: card.brand,
            set: card.set,
            parallel: card.parallel,
            condition: card.condition,
            currentMarketValue: card.currentMarketValue,
            estimatedGrade: card.estimatedGrade,
            grader: card.grader,
            cardNumber: card.cardNumber,
        };

        console.log(`[Analysis] Calling Python Agent for ${card.player} (${cleanedCard.year})...`);

        const agentResponse = await fetch(`${agentUrl}/analyze-card`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ card: cleanedCard }),
        });

        if (!agentResponse.ok) {
            throw new Error(
                `Agent returned ${agentResponse.status}: ${await agentResponse.text()}`
            );
        }

        const result = await agentResponse.json();
        const analysis = result?.analysis;

        if (analysis === undefined || analysis === null) {
            throw new Error(
                "Analysis agent returned a response without an analysis payload."
            );
        }

        console.log(`[Analysis] Agent completed analysis for ${card.player}`);

        return { success: true, result: analysis };
    } catch (error: any) {
        console.error("[Analysis Error] Agent failed, trying Genkit fallback:", error);
        try {
            const { analyzeCardInvestment } = await import("@/ai/flows/analyze-card");
            const fallback = await analyzeCardInvestment({
                card: {
                    ...card,
                    year: normalizeHockeyCardYear({
                        year: card.year,
                        brand: card.brand,
                        player: card.player,
                        cardNumber: card.cardNumber,
                        set: card.set,
                    }).year,
                },
            });
            return { success: true, result: fallback };
        } catch (fallbackErr: any) {
            console.error("[Analysis Error] Genkit fallback failed:", fallbackErr);
            return {
                success: false,
                error: fallbackErr?.message || error?.message || "Analysis failed",
            };
        }
    }
}
