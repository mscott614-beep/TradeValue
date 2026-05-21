"use server";

import { getCardDeepDive } from "@/ai/flows/get-card-deep-dive";
import { Portfolio } from "@/lib/types";

export async function getCardDeepDiveAction(card: Portfolio) {
    if (!card || !card.id) {
        return { success: false as const, error: "Valid card data is required" };
    }

    try {
        console.log(`[ACTION] Shadow Deep Dive: ${card.player} (${card.id})`);
        
        // Strip out massive duplicated listing data that is not used by the model
        const cleanedCard = {
            id: card.id,
            title: card.title,
            player: card.player,
            year: card.year,
            brand: card.brand,
            set: card.set,
            cardNumber: card.cardNumber,
            parallel: card.parallel,
            condition: card.condition,
            currentMarketValue: card.currentMarketValue,
            estimatedGrade: card.estimatedGrade,
            grader: card.grader,
        };

        const result = await getCardDeepDive(cleanedCard);

        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to perform card deep dive:", error);
        return { success: false as const, error: error.message || "Deep Dive failed" };
    }
}
