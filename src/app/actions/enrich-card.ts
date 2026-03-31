"use server";

import { ai } from "@/ai/genkit";
import { z } from "genkit";
import { getAdminDb } from "@/lib/firebase-server";
import { Portfolio } from "@/lib/types";
import { refreshCardValueAction } from "./refresh-card-value";

const EnrichmentOutputSchema = z.object({
    brand: z.string().optional().describe("Manufacturer of the card (e.g. Topps, Upper Deck)"),
    set: z.string().optional().describe("The specific set or product line (e.g. Series 1, The Cup, Prizm)"),
    year: z.string().optional().describe("The year the card was produced"),
    cardNumber: z.string().optional().describe("The card number"),
    imageUrl: z.string().url().optional().describe("A high-resolution image URL of the card front"),
});

/**
 * Helper to call AI with 15s backoff for 429 errors and model pivot failover.
 */
async function generateWithPivot(prompt: string, useSearch: boolean, maxRetries = 3) {
    const primaryModel = 'googleai/gemini-3.1-flash-lite-preview';
    const fallbackModel = 'googleai/gemini-1.5-flash';
    
    // First try: Primary Model with 3 retries (15s backoff)
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await ai.generate({
                model: primaryModel as any,
                prompt,
                output: { schema: EnrichmentOutputSchema },
                config: {
                    temperature: 0.1,
                    // @ts-ignore
                    googleSearchRetrieval: useSearch ? {} : undefined,
                },
            });
        } catch (error: any) {
            const isRateLimit = error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
            if (isRateLimit && i < maxRetries - 1) {
                console.warn(`[Quota Limit] Waiting 15s to retry primary model... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 15000));
                continue;
            }
            if (isRateLimit && i === maxRetries - 1) {
                console.warn(`[Quota Limit] Primary model exhausted. Pivoting to stable fallback: ${fallbackModel}`);
                // Fall through to try fallback model
            } else {
                throw error;
            }
        }
    }

    // Final Try: Stable Fallback Model
    try {
        return await ai.generate({
            model: fallbackModel as any,
            prompt,
            output: { schema: EnrichmentOutputSchema },
            config: {
                temperature: 0.1,
                // Still try search on fallback if needed
                // @ts-ignore
                googleSearchRetrieval: useSearch ? {} : undefined,
            },
        });
    } catch (fallbackError: any) {
        console.error(`[Fatal Quota] Both primary and fallback models exhausted.`, fallbackError);
        throw fallbackError;
    }
}

/**
 * Enriches a single card with Smart Grounding and Pivot Resilience.
 */
export async function enrichCardAction(userId: string, card: Portfolio) {
    try {
        const isPlaceholder = !card.imageUrl || card.imageUrl.includes("picsum.photos") || card.imageUrl.includes("placeholder");
        const useSearch = isPlaceholder; // Smart Grounding: Only search if image is missing

        console.log(`[Enrich Serial] Starting: ${card.title} (Search: ${useSearch ? 'ON' : 'OFF'})`);

        const prompt = `Find metadata for this trading card: "${card.title}".
        Metadata needed: Manufacturer (brand), Set Name, Year, Card Number.
        ${useSearch ? 'IMPORTANT: Also search for and provide a direct high-resolution image URL to the front of this card.' : 'Note: Image already exists, do not search for new image URLs.'}
        Verify all metadata against the provided title. Return JSON.`;

        const { output } = await generateWithPivot(prompt, useSearch);

        if (!output) {
            throw new Error("AI failed to return enrichment data.");
        }

        // Smart Update Logic
        const updates: Partial<Portfolio> = {
            lastEnriched: new Date().toISOString(),
        };

        if (output.brand && (!card.brand || card.brand === "None")) updates.brand = output.brand;
        if (output.set && (!card.set || card.set === "None")) updates.set = output.set;
        if (output.year && (!card.year || card.year === "None")) updates.year = output.year;
        if (output.cardNumber && (!card.cardNumber || card.cardNumber === "None")) updates.cardNumber = output.cardNumber;
        
        if (output.imageUrl && isPlaceholder) {
            updates.imageUrl = output.imageUrl;
        }

        // Refresh Price individually
        const updatedCardForPricing = { ...card, ...updates };
        const priceResult = await refreshCardValueAction(userId, updatedCardForPricing);

        if (priceResult.success) {
            updates.currentMarketValue = priceResult.newPrice;
            updates.lastMarketValueUpdate = priceResult.lastUpdated || new Date().toISOString();
        }

        // Data Flags
        const flags: string[] = [];
        const finalImage = updates.imageUrl || card.imageUrl;
        if (!finalImage || finalImage.includes("placeholder") || finalImage.includes("picsum.photos")) {
            flags.push("MISSING_IMAGE");
        }
        const lastEnriched = updates.lastEnriched ? new Date(updates.lastEnriched) : (card.lastEnriched ? new Date(card.lastEnriched) : new Date(0));
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (lastEnriched < thirtyDaysAgo) flags.push("OUTDATED");
        updates.dataFlags = flags;

        // Update Firestore
        const db = getAdminDb();
        const cardRef = db.doc(`users/${userId}/portfolios/${card.id}`);
        await cardRef.update({
            ...updates,
            status: priceResult.success ? 'success' : 'enrichment_only_success'
        });

        return { 
            success: true, 
            cardId: card.id, 
            title: card.title,
            metadata: updates,
            price: priceResult.success ? priceResult.newPrice : card.currentMarketValue,
            log: `✅ ${card.title} enriched.${!useSearch ? ' (Search skipped)' : ''}`
        };

    } catch (error: any) {
        const isRateLimit = error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
        console.error(`[Enrich Serial] Error for ${card.id}:`, error);
        return { 
            success: false, 
            cardId: card.id, 
            error: error.message || "Enrichment failed",
            isRateLimit,
            log: `❌ ${card.title}: ${isRateLimit ? 'Quota Limit Exhausted' : (error.message || "Failed")}`
        };
    }
}

// Wrapper for the existing batch caller to maintain UI compatibility
export async function enrichCardsBatchAction(userId: string, cards: Portfolio[]) {
    // Reverted to Serial: We just process the first one of the batch
    if (cards.length === 0) return { success: false, error: "Empty batch" };
    
    const result = await enrichCardAction(userId, cards[0]);
    return { 
        success: result.success, 
        batchResults: [result],
        isRateLimit: result.isRateLimit
    };
}
