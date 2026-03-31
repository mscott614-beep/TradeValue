"use server";

import { ai } from "@/ai/genkit";
import { z } from "genkit";
import { getAdminDb } from "@/lib/firebase-server";
import { Portfolio } from "@/lib/types";
import { refreshCardValueAction } from "./refresh-card-value";

const EnrichmentOutputSchema = z.object({
    id: z.string().describe("The unique ID of the card being enriched"),
    brand: z.string().optional().describe("Manufacturer of the card (e.g. Topps, Upper Deck)"),
    set: z.string().optional().describe("The specific set or product line (e.g. Series 1, The Cup, Prizm)"),
    year: z.string().optional().describe("The year the card was produced"),
    cardNumber: z.string().optional().describe("The card number"),
    imageUrl: z.string().url().optional().describe("A high-resolution image URL of the card front"),
});

const EnrichmentBatchOutputSchema = z.array(EnrichmentOutputSchema);

/**
 * Helper to call AI with exponential backoff for 429 errors.
 * Sequence: 5s, 10s, 20s as requested.
 */
async function generateWithBackoff(prompt: string, maxRetries = 3) {
    const retryIntervals = [5000, 10000, 20000];
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await ai.generate({
                prompt,
                output: { schema: EnrichmentBatchOutputSchema },
                config: {
                    temperature: 0.1,
                    // @ts-ignore
                    googleSearchRetrieval: {},
                },
            });
        } catch (error: any) {
            const isRateLimit = error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
            if (isRateLimit && i < maxRetries - 1) {
                const waitTime = retryIntervals[i];
                console.warn(`[Enrich Batch] Rate limit hit. Retrying in ${waitTime}ms... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            throw error;
        }
    }
    throw new Error("Max retries exceeded for AI generation.");
}

/**
 * Enriches a batch of cards (max 5) using a single Gemini call.
 */
export async function enrichCardsBatchAction(userId: string, cards: Portfolio[]) {
    try {
        console.log(`[Enrich Batch] Processing ${cards.length} cards in one request.`);

        const prompt = `Search for the following ${cards.length} trading cards. For each, find the High-res Image URL and Manufacturer Set Details (Year, Set, Card Number). 
        Return a JSON array where each object matches the schema and includes the original card ID.
        
        Cards to process:
        ${cards.map((c, i) => `${i+1}. "${c.title}" (Current Brand: ${c.brand || 'Unknown'}, Current Set: ${c.set || 'Unknown'}, Current Year: ${c.year || 'Unknown'})`).join('\n')}
        
        Important: Prioritize high-resolution, direct image URLs. Verify all metadata against the provided titles.`;

        const { output } = await generateWithBackoff(prompt);

        if (!output || !Array.isArray(output)) {
            throw new Error("AI failed to return a valid result array.");
        }

        const results = [];

        // Loop through each card in the batch to update individually
        for (const card of cards) {
            const aiResult = output.find(r => r.id === card.id) || output[cards.indexOf(card)]; // Fallback to index if ID match fails
            
            if (!aiResult) {
                results.push({ success: false, cardId: card.id, error: "AI result not found in batch" });
                continue;
            }

            // Smart Update Logic
            const updates: Partial<Portfolio> = {
                lastEnriched: new Date().toISOString(),
            };

            if (aiResult.brand && (!card.brand || card.brand === "None")) updates.brand = aiResult.brand;
            if (aiResult.set && (!card.set || card.set === "None")) updates.set = aiResult.set;
            if (aiResult.year && (!card.year || card.year === "None")) updates.year = aiResult.year;
            if (aiResult.cardNumber && (!card.cardNumber || card.cardNumber === "None")) updates.cardNumber = aiResult.cardNumber;
            
            const isPlaceholder = !card.imageUrl || card.imageUrl.includes("picsum.photos") || card.imageUrl.includes("placeholder");
            if (aiResult.imageUrl && isPlaceholder) {
                updates.imageUrl = aiResult.imageUrl;
            }

            // Refresh Price individually after metadata merge
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

            results.push({ 
                success: true, 
                cardId: card.id, 
                title: card.title,
                metadata: updates,
                price: priceResult.success ? priceResult.newPrice : card.currentMarketValue
            });
        }

        return { success: true, batchResults: results };

    } catch (error: any) {
        console.error(`[Enrich Batch] Fatal error:`, error);
        return { 
            success: false, 
            error: error.message || "Batch enrichment failed",
            isRateLimit: error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED")
        };
    }
}

// Keep the old single-card action for backward compatibility during transition if needed
export async function enrichCardAction(userId: string, card: Portfolio) {
    // This is essentially a batch of one
    const result = await enrichCardsBatchAction(userId, [card]);
    if (result.success && result.batchResults) {
        const item = result.batchResults[0];
        return { success: item.success, log: item.success ? `✅ ${card.title} enriched.` : `❌ ${card.title} failed.` };
    }
    return { success: false, error: result.error };
}
