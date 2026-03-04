"use server";

import { analyzeCardInvestment } from "@/ai/flows/analyze-card";
import { Portfolio } from "@/lib/types";

export async function analyzeCardAction(card: Portfolio) {
    try {
        const result = await analyzeCardInvestment({ card });
        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to analyze card:", error);
        return { success: false as const, error: error.message || "Failed to analyze card" };
    }
}
