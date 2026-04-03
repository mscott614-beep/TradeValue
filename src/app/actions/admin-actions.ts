"use server";

import { getAdminDb, getAdminApp } from "@/lib/firebase-server";
import { getFunctions } from "firebase-admin/functions";

/**
 * Manually triggers a global market refresh for all cards in the database.
 * Strictly restricted to mscott614@gmail.com.
 */
export async function triggerAdminMarketRefreshAction(adminEmail: string) {
    // 1. Strict Authorization Check
    if (adminEmail !== 'mscott614@gmail.com') {
        console.error(`Unauthorized access attempt to Admin Refresh from: ${adminEmail}`);
        throw new Error("Unauthorized: Administrative access required.");
    }

    try {
        const db = getAdminDb();
        const app = getAdminApp();
        
        // 2. Fetch all user's portfolio documents
        const usersDocs = await db.collection("users").listDocuments();
        const queue = getFunctions(app).taskQueue("locations/us-central1/functions/refreshCardTask");

        console.log(`[AdminRefresh] manual trigger by ${adminEmail}. Processing ${usersDocs.length} users.`);

        let totalEnqueued = 0;
        
        // We use loops here for the admin trigger as simplicity is preferred over complex batching
        // for this low-frequency manual action.
        for (const userDoc of usersDocs) {
            const portfoliosRef = userDoc.collection("portfolios");
            const portfolioDocs = await portfoliosRef.listDocuments();
            
            for (const cardDoc of portfolioDocs) {
                // Enqueue each card for the refreshCardTask Cloud Function
                await queue.enqueue({
                    userId: userDoc.id,
                    cardId: cardDoc.id
                });
                totalEnqueued++;
            }
        }

        console.log(`[AdminRefresh] Successfully enqueued ${totalEnqueued} cards across all users.`);
        
        return { 
            success: true as const, 
            message: `Synchronization started. Enqueued ${totalEnqueued} cards for market analysis.`,
            count: totalEnqueued
        };
    } catch (error: any) {
        console.error("Failed to trigger manual refresh:", error);
        return { 
            success: false as const, 
            error: error.message || "An unexpected error occurred during global sync." 
        };
    }
}
