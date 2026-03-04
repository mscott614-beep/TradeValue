"use server";

import { getPortfolioInsights } from "@/ai/flows/get-portfolio-insights";
import { Portfolio } from "@/lib/types";

export async function getPortfolioInsightsAction(cards: Portfolio[]) {
    try {
        const result = await getPortfolioInsights({ cards });
        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to get portfolio insights:", error);
        return { success: false as const, error: error.message || "Failed to get portfolio insights" };
    }
}
