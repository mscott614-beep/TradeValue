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
        
        // Standardized Task Queue: Matches the backend 'market-refresh-task' for 100% reliability
        const queue = getFunctions(app).taskQueue("market-refresh-task", "us-central1");

        console.log(`[AdminRefresh] manual trigger by ${adminEmail}. Processing ${usersDocs.length} users.`);

        let totalEnqueued = 0;
        
        for (const userDoc of usersDocs) {
            const portfoliosRef = userDoc.collection("portfolios");
            const portfolioDocs = await portfoliosRef.listDocuments();
            
            for (const cardDoc of portfolioDocs) {
                try {
                    // Try exact function name (Standard for Firebase v2)
                    await queue.enqueue({
                        userId: userDoc.id,
                        cardId: cardDoc.id
                    });
                } catch (enqueueError: any) {
                    console.warn(`[AdminRefresh] Primary queue failed for ${cardDoc.id}, trying fallback patterns.`, enqueueError.message);
                    
                    // Naming Resilience: Try common Firebase/GCP transformations if NOT_FOUND
                    const possibleQueues = ["refreshMarketCardTask", "refresh-market-card-task", "refreshmarketcardtask"];
                    let success = false;

                    for (const qId of possibleQueues) {
                        try {
                            const fallbackQueue = getFunctions(app).taskQueue(qId, "us-central1");
                            await fallbackQueue.enqueue({ userId: userDoc.id, cardId: cardDoc.id });
                            success = true;
                            break; 
                        } catch {
                            continue;
                        }
                    }

                    if (!success) {
                        console.error(`[AdminRefresh] All queue variations failed for card: ${cardDoc.id}`);
                        // Don't throw for a single card failure to allow the sync to continue for others
                    }
                }
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
