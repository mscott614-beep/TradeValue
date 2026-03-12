"use server";

import { generateTrendingCards } from "@/ai/flows/generate-trending-cards";

export async function generateTrendingCardsAction() {
    try {
        const result = await generateTrendingCards({});
        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to generate trending cards:", error);
        return { success: false as const, error: error.message || "Failed to generate trending cards" };
    }
}
