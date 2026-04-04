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
        
        let totalEnqueued = 0;

        // Standardized Task Queue: Using the full path for maximum reliability
        const queue = getFunctions(app).taskQueue("locations/us-central1/functions/refreshMarketCardTask");

        // Use collectionGroup for robust discovery of all portfolios anywhere in the database
        console.log(`[AdminRefresh] Discovering all cards globally...`);
        const cardsSnap = await db.collectionGroup("portfolios").get();
        const cardDocs = cardsSnap.docs;
        const totalCards = cardDocs.length;
        
        // Track unique user IDs for reporting
        const userIds = new Set<string>();

        for (const cardDoc of cardDocs) {
            try {
                // Determine the userId from the parent reference: users/{userId}/portfolios/{cardId}
                const userId = cardDoc.ref.parent.parent?.id;

                if (!userId) {
                    console.error(`[AdminRefresh] Could not determine userId for card ${cardDoc.id}`);
                    continue;
                }

                userIds.add(userId);

                await queue.enqueue({
                    userId: userId,
                    cardId: cardDoc.id
                });
                totalEnqueued++;
            } catch (err: any) {
                console.error(`[AdminRefresh] Error enqueuing card ${cardDoc.id} for user ${cardDoc.ref.parent.parent?.id}:`, err.message);
            }
        }

        return { 
            success: true as const, 
            message: `Global sync (v3.3) started. Enqueued ${totalEnqueued} cards for ${userIds.size} users globally.`,
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
