"use server";

import { getCardDeepDive } from "@/ai/flows/get-card-deep-dive";
import { Portfolio } from "@/lib/types";

export async function getCardDeepDiveAction(card: Portfolio) {
    if (!card || !card.id) {
        return { success: false as const, error: "Valid card data is required" };
    }

    try {
        console.log(`[ACTION] Shadow Deep Dive: ${card.player} (${card.id})`);
        
        const result = await getCardDeepDive(card);

        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to perform card deep dive:", error);
        return { success: false as const, error: error.message || "Deep Dive failed" };
    }
}
