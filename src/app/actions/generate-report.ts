"use server";

import { generateMarketReport } from "@/ai/flows/generate-market-report";
import { generateTrendingCards } from "@/ai/flows/generate-trending-cards";

export async function generateReportAction(topic?: string) {
    try {
        // Fetch current trending cards to provide context for the snapshot table
        const trendingData = await generateTrendingCards({});
        
        const result = await generateMarketReport({ 
            topic,
            trendingData: trendingData.map(t => ({
                player: t.player,
                title: t.title,
                value: t.value,
                change: t.change,
                trend: t.trend
            }))
        });
        
        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to generate report:", error);
        return { success: false as const, error: error.message || "Failed to generate report" };
    }
}
