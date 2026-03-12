"use server";

import { generateLiveAuctions } from "@/ai/flows/generate-live-auctions";

export async function generateAuctionsAction(topic?: string) {
    try {
        const result = await generateLiveAuctions({ topic });
        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to generate auctions:", error);
        return { success: false as const, error: error.message || "Failed to generate auctions" };
    }
}
