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

        // Use listDocuments() for robust user discovery (even if user docs have no top-level fields)
        console.log(`[AdminRefresh] Discovering all users...`);
        const userRefs = await db.collection("users").listDocuments();
        const totalUsers = userRefs.length;
        console.log(`[AdminRefresh] Found ${totalUsers} users.`);

        for (const userRef of userRefs) {
            try {
                // List all card documents in the user's portfolio subcollection
                const portfoliosSnap = await userRef.collection("portfolios").get();
                
                if (portfoliosSnap.size === 0) {
                    continue;
                }

                console.log(`[AdminRefresh] User ${userRef.id}: Found ${portfoliosSnap.size} cards. Enqueuing...`);

                for (const cardDoc of portfoliosSnap.docs) {
                    try {
                        await queue.enqueue({
                            userId: userRef.id,
                            cardId: cardDoc.id
                        });
                        totalEnqueued++;
                    } catch (err: any) {
                        console.error(`[AdminRefresh] Error enqueuing card ${cardDoc.id} for user ${userRef.id}:`, err.message);
                    }
                }
            } catch (userError: any) {
                console.error(`[AdminRefresh] Error processing user ${userRef.id}:`, userError.message);
            }
        }

        return { 
            success: true as const, 
            message: `Global sync (v3.2) started. Processing ${totalUsers} users and ${totalEnqueued} cards globally.`,
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
