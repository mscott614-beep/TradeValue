"use server";

import {
    predictAuctionWinProbability,
} from "@/ai/flows/predict-auction-win-probability";

export async function predictAuctionAction(input: {
    auctionItemDescription: string;
    userBidAmount: number;
}) {
    try {
        const result = await predictAuctionWinProbability(input);
        return { success: true as const, result };
    } catch (error) {
        console.error("AI Prediction Error:", error);
        return { success: false as const, error: "Prediction failed" };
    }
}
