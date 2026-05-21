"use server";

import { runMarketScanner } from "@/ai/flows/market-scanner";
import { getUserPortfolioServer, getUserAlertConfigsServer, getAdminDb } from "@/lib/firebase-server";

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

        const result = await runMarketScanner({ 
            cards: cleanedCards, 
            alertsConfig: alertsConfig.filter(c => c.isActive), 
            scanType, 
            userEmail 
        });

        // Data Sanity: Automatic Updates for Flagged Cards
        // If the grounded search found a massive discrepancy (> 80%), we update the card now.
        if (result.alerts && result.alerts.length > 0) {
            const db = getAdminDb();
            const updates = result.alerts
                .filter(a => a.requiresUpdate && a.relatedCardId && a.suggestedPrice)
                .map(async (alert) => {
                    try {
                        const cardRef = db.doc(`users/${userId}/portfolios/${alert.relatedCardId}`);
                        const cardSnap = await cardRef.get();
                        
                        if (cardSnap.exists) {
                            const oldVal = cardSnap.data()?.currentMarketValue || 0;
                            const newVal = alert.suggestedPrice!;
                            
                            await cardRef.update({
                                currentMarketValue: newVal,
                                valueChange24h: newVal - oldVal,
                                lastMarketValueUpdate: new Date().toISOString(),
                                dataFlags: ['GROUNDED_UPDATE']
                            });
                            console.log(`[Shadow] Auto-updated card ${alert.relatedCardId}: $${oldVal} -> $${newVal}`);
                        }
                    } catch (e) {
                        console.error(`[Shadow] Failed to auto-update card ${alert.relatedCardId}:`, e);
                    }
                });
            
            await Promise.all(updates);
        }

        return { success: true as const, result };
    } catch (error: any) {
        console.error("Failed to run market scanner:", error);
        return { success: false as const, error: error.message || "Failed to run market scanner" };
    }
}
