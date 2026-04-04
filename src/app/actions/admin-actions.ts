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
        
        // 2. Fetch ALL portfolio documents across ALL users using a Collection Group query
        // select() with no arguments ensures we only fetch metadata (IDs) to save bandwidth/memory
        const snapshot = await db.collectionGroup("portfolios").select().get();
        
        // Standardized Task Queue: Points directly to the deployed Cloud Function name
        const queue = getFunctions(app).taskQueue("refreshMarketCardTask", "us-central1");
        
        console.log(`[AdminRefresh] manual trigger by ${adminEmail}. Found ${snapshot.size} total cards across all portfolios.`);

        let totalEnqueued = 0;
        
        for (const doc of snapshot.docs) {
            try {
                // The path format is 'users/{userId}/portfolios/{cardId}'
                const pathParts = doc.ref.path.split('/');
                const userId = pathParts[pathParts.indexOf('users') + 1];
                const cardId = pathParts[pathParts.indexOf('portfolios') + 1];

                if (!userId || !cardId) {
                    console.warn(`[AdminRefresh] Skipping invalid path structure: ${doc.ref.path}`);
                    continue;
                }

                // Directly enqueue using the primary queue name
                await queue.enqueue({
                    userId,
                    cardId
                });
                totalEnqueued++;

                // Optional: Log progress every 100 cards
                if (totalEnqueued % 100 === 0) {
                    console.log(`[AdminRefresh] Progress: Enqueued ${totalEnqueued} cards...`);
                }
            } catch (enqueueError: any) {
                console.error(`[AdminRefresh] Failed to enqueue card ${doc.id}:`, enqueueError.message);
                // Silently fail for one card to avoid crashing the whole sync
            }
        }

        return { 
            success: true as const, 
            message: `Synchronization started. Enqueued ${totalEnqueued} cards across the global database.`,
            count: totalEnqueued
        };
    } catch (error: any) {
        console.error("Failed to trigger manual refresh:", error);
        
        // Specific IAM Error Handling for clearer user feedback
        if (error.message?.includes('permission') || error.code === 'permission-denied') {
            return {
                success: false as const,
                error: "IAM Permission Error: The App Hosting service account lacks 'Cloud Tasks Enqueuer' permission. Please check the implementation plan for instructions."
            };
        }

        return { 
            success: false as const, 
            error: error.message || "An unexpected error occurred during global sync." 
        };
    }
}
