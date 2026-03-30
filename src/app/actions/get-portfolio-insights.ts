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

        const result = await getPortfolioInsights({ cards });
        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to get portfolio insights:", error);
        return { success: false as const, error: error.message || "Failed to get portfolio insights" };
    }
}
