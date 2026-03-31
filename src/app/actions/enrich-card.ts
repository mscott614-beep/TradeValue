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
 * Enriches a single card using Gemini 3.1 Flash with Google Search Retrieval.
 * Implements Smart Update: Only overwrites null/empty fields.
 */
export async function enrichCardAction(userId: string, card: Portfolio) {
    try {
        console.log(`[Enrich] Starting enrichment for: ${card.title} (${card.id})`);

        // 1. AI Search via Gemini with Google Search tool
        const prompt = `Find the following metadata and a high-resolution image URL for this trading card: "${card.title}".
        Metadata needed: Manufacturer (brand), Set Name, Year, Card Number.
        If the current card already has some details like year "${card.year}" or brand "${card.brand}", verify them.
        Provide a direct link to a high-quality image of the front of the card.`;

        const { output } = await ai.generate({
            prompt,
            output: { schema: EnrichmentOutputSchema },
            config: {
                temperature: 0.1,
                // @ts-ignore - googleSearchRetrieval is a special feature of Gemini in Genkit
                googleSearchRetrieval: {},
            },
        });

        if (!output) {
            throw new Error("AI failed to return enrichment data.");
        }

        console.log(`[Enrich] AI Results for ${card.id}:`, output);

        // 2. Smart Update Logic & Data Flag Check
        const updates: Partial<Portfolio> = {
            lastEnriched: new Date().toISOString(),
        };

        // Only update if current is missing or placeholder and AI provided a value
        if (output.brand && (!card.brand || card.brand === "None")) updates.brand = output.brand;
        if (output.set && (!card.set || card.set === "None")) updates.set = output.set;
        if (output.year && (!card.year || card.year === "None")) updates.year = output.year;
        if (output.cardNumber && (!card.cardNumber || card.cardNumber === "None")) updates.cardNumber = output.cardNumber;
        
        // Image update: Only if current is missing or looks like a placeholder
        const isPlaceholder = !card.imageUrl || card.imageUrl.includes("picsum.photos") || card.imageUrl.includes("placeholder");
        if (output.imageUrl && isPlaceholder) {
            updates.imageUrl = output.imageUrl;
        }

        // 3. Refresh Price using existing Lead Architect logic
        // Important: Merge newly found metadata into the card object for the price search query
        const updatedCardForPricing = {
            ...card,
            ...updates
        };
        const priceResult = await refreshCardValueAction(userId, updatedCardForPricing);

        if (priceResult.success) {
            updates.currentMarketValue = priceResult.newPrice;
            updates.lastMarketValueUpdate = priceResult.lastUpdated || new Date().toISOString();
        }

        // 4. Update Data Flags
        const flags: string[] = [];
        const finalImage = updates.imageUrl || card.imageUrl;
        if (!finalImage || finalImage.includes("placeholder") || finalImage.includes("picsum.photos")) {
            flags.push("MISSING_IMAGE");
        }
        
        // Outdated check: If not enriched/updated in 30 days
        const lastEnriched = updates.lastEnriched ? new Date(updates.lastEnriched) : (card.lastEnriched ? new Date(card.lastEnriched) : new Date(0));
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (lastEnriched < thirtyDaysAgo) flags.push("OUTDATED");
        
        updates.dataFlags = flags;

        // 5. Update Firestore
        const db = getAdminDb();
        const cardRef = db.doc(`users/${userId}/portfolios/${card.id}`);
        
        await cardRef.update({
            ...updates,
            status: priceResult.success ? 'success' : 'enrichment_only_success'
        });

        return { 
            success: true, 
            metadata: updates,
            price: priceResult.success ? priceResult.newPrice : card.currentMarketValue,
            diagnostics: priceResult.diagnostics || "Price refresh failed during enrichment"
        };

    } catch (error: any) {
        console.error(`[Enrich] Failed for card ${card.id}:`, error);
        return { 
            success: false, 
            cardId: card.id, 
            error: error.message || "Enrichment failed",
            log: `❌ ${card.title}: ${error.message || "Enrichment failed"}`
        };
    }
}
