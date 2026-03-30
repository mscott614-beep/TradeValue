"use server";

import { runMarketScanner } from "@/ai/flows/market-scanner";
import { getUserPortfolioServer, getUserAlertConfigsServer } from "@/lib/firebase-server";

export async function runMarketScannerAction(
    userId: string,
    scanType: 'standard' | 'deep' = 'standard',
    userEmail?: string
) {
    if (!userId) {
        return { success: false as const, error: "User ID is required" };
    }

    try {
        console.log(`[ACTION] Fetching data for scan: ${userId} (${scanType})`);
        // Fetch data server-side to avoid large payload from client
        const [cards, alertsConfig] = await Promise.all([
            getUserPortfolioServer(userId),
            getUserAlertConfigsServer(userId)
        ]);

        if (!cards || cards.length === 0) {
            return { success: true as const, result: { alerts: [] } };
        }

        const result = await runMarketScanner({ 
            cards, 
            alertsConfig: alertsConfig.filter(c => c.isActive), 
            scanType, 
            userEmail 
        });

        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to run market scanner:", error);
        return { success: false as const, error: error.message || "Failed to run market scanner" };
    }
}
