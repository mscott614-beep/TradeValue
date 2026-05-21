"use server";

import { getPortfolioInsights } from "@/ai/flows/get-portfolio-insights";
import { getUserPortfolioServer } from "@/lib/firebase-server";

export async function getPortfolioInsightsAction(userId: string) {
    if (!userId) {
        return { success: false as const, error: "User ID is required" };
    }

    try {
        const cards = await getUserPortfolioServer(userId);
        
        if (!cards || cards.length === 0) {
            return { success: true as const, result: { summary: "No cards found in portfolio.", items: [] } };
        }

        // Strip out massive duplicated listing data that is not used by the model
        const cleanedCards = cards.map(c => ({
            id: c.id,
            title: c.title,
            player: c.player,
            year: c.year,
            brand: c.brand,
            set: c.set,
            cardNumber: c.cardNumber,
            parallel: c.parallel,
            condition: c.condition,
            currentMarketValue: c.currentMarketValue,
            estimatedGrade: c.estimatedGrade,
            grader: c.grader,
        }));

        const result = await getPortfolioInsights({ cards: cleanedCards });
        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to get portfolio insights:", error);
        return { success: false as const, error: error.message || "Failed to get portfolio insights" };
    }
}
