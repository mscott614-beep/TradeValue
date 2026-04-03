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
        
        // Use the new renamed function for better reliability and avoiding past conflicts
        const queue = getFunctions(app).taskQueue("refreshMarketCardTask", "us-central1");

        console.log(`[AdminRefresh] manual trigger by ${adminEmail}. Processing ${usersDocs.length} users.`);

        let totalEnqueued = 0;
        
        for (const userDoc of usersDocs) {
            const portfoliosRef = userDoc.collection("portfolios");
            const portfolioDocs = await portfoliosRef.listDocuments();
            
            for (const cardDoc of portfolioDocs) {
                await queue.enqueue({
                    userId: userDoc.id,
                    cardId: cardDoc.id
                });
                totalEnqueued++;
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
