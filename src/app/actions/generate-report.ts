"use server";

import { generateMarketReport } from "@/ai/flows/generate-market-report";

export async function generateReportAction(topic?: string) {
    try {
        const result = await generateMarketReport({ topic });
        return { success: true as const, result };
    } catch (error) {
        console.error("Failed to generate report:", error);
        return { success: false as const, error: "Failed to generate report" };
    }
}
