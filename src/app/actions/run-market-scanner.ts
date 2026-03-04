"use server";

import { runMarketScanner } from "@/ai/flows/market-scanner";
import { Portfolio, AlertConfig } from "@/lib/types";

export async function runMarketScannerAction(cards: Portfolio[], alertsConfig: AlertConfig[]) {
    try {
        const result = await runMarketScanner({ cards, alertsConfig });
        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to run market scanner:", error);
        return { success: false as const, error: error.message || "Failed to run market scanner" };
    }
}
