"use server";

import { getAdminDb } from "@/lib/firebase-server";
import { Portfolio } from "@/lib/types";

/**
 * Fetches all cards in the user's portfolio to be processed by the enrichment dashboard.
 */
export async function getEnrichmentPool(userId: string): Promise<{ success: boolean; cards?: Portfolio[]; error?: string }> {
    try {
        const db = getAdminDb();
        const snapshot = await db.collection(`users/${userId}/portfolios`).get();
        
        const cards = snapshot.docs.map((doc: any) => ({
            id: doc.id,
            ...doc.data()
        })) as Portfolio[];

        return { success: true, cards };
    } catch (error: any) {
        console.error("Failed to fetch enrichment pool:", error);
        return { success: false, error: error.message };
    }
}
