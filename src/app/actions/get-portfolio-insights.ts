"use server";

import { getPortfolioInsights } from "@/ai/flows/get-portfolio-insights";

export async function getPortfolioInsightsAction(userId: string, trimmedCards: any[]) {
    if (!userId) {
        return { success: false as const, error: "User ID is required" };
    }

    try {
        if (!trimmedCards || trimmedCards.length === 0) {
            return { success: true as const, result: { summary: "No cards found in portfolio.", items: [] } };
        }

        const result = await getPortfolioInsights({ cards: trimmedCards });
        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to get portfolio insights:", error);
        return { success: false as const, error: error.message || "Failed to get portfolio insights" };
    }
}
