"use server";

import { getAdminDb, getAdminApp } from "@/lib/firebase-server";
import { getFunctions } from "firebase-admin/functions";

// Targeted user for fallback/manual check
const MSCOTT614_UID = 'x6PdMgJJrUP6rGOAqC2zaJd6dRI3';

/**
 * Manually triggers a global market refresh for all cards in the database.
 * Strictly restricted to mscott614@gmail.com.
 * v3.4: Multi-layered discovery for maximum reliability.
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
        const projectId = app.options.projectId;
        console.log(`[AdminRefresh] Starting sync (v3.4) for project: ${projectId}`);
        
        let totalEnqueued = 0;
        const userIdsUsed = new Set<string>();

        // Standardized Task Queue
        const queue = getFunctions(app).taskQueue("locations/us-central1/functions/refreshMarketCardTask");

        // --- STRATEGY 1: Collection Group Discovery ---
        console.log(`[AdminRefresh] Strategy 1: Discovering via collectionGroup("portfolios")...`);
        const cardsSnap = await db.collectionGroup("portfolios").get();
        
        if (!cardsSnap.empty) {
            console.log(`[AdminRefresh] Strategy 1 success: Found ${cardsSnap.size} cards.`);
            for (const cardDoc of cardsSnap.docs) {
                const userId = cardDoc.ref.parent.parent?.id;
                if (userId) {
                    await queue.enqueue({ userId, cardId: cardDoc.id });
                    userIdsUsed.add(userId);
                    totalEnqueued++;
                }
            }
        } else {
            console.warn(`[AdminRefresh] Strategy 1 returned 0 documents. Index may be missing or building.`);

            // --- STRATEGY 2: User-by-User Iteration Fallback ---
            console.log(`[AdminRefresh] Strategy 2: Falling back to User-by-User discovery...`);
            const usersSnap = await db.collection("users").get();
            console.log(`[AdminRefresh] Found ${usersSnap.size} user documents to scan.`);

            for (const userDoc of usersSnap.docs) {
                const userId = userDoc.id;
                const portfoliosSnap = await db.collection(`users/${userId}/portfolios`).get();
                
                if (!portfoliosSnap.empty) {
                    console.log(`[AdminRefresh] User ${userId}: found ${portfoliosSnap.size} cards.`);
                    for (const cardDoc of portfoliosSnap.docs) {
                        await queue.enqueue({ userId, cardId: cardDoc.id });
                        userIdsUsed.add(userId);
                        totalEnqueued++;
                    }
                }
            }
        }

        // --- STRATEGY 3: Final Targeted Safety Check (mscott614) ---
        // Ensure that even if user listing fails, we check the specific primary user
        if (!userIdsUsed.has(MSCOTT614_UID)) {
            console.log(`[AdminRefresh] Strategy 3: Targeted safety check for mscott614...`);
            const mscottSnap = await db.collection(`users/${MSCOTT614_UID}/portfolios`).get();
            if (!mscottSnap.empty) {
                console.log(`[AdminRefresh] Strategy 3 found ${mscottSnap.size} cards for mscott614.`);
                for (const cardDoc of mscottSnap.docs) {
                    await queue.enqueue({ userId: MSCOTT614_UID, cardId: cardDoc.id });
                    totalEnqueued++;
                }
                userIdsUsed.add(MSCOTT614_UID);
            }
        }

        return { 
            success: true as const, 
            message: `Global sync (v3.4) complete. Enqueued ${totalEnqueued} cards for ${userIdsUsed.size} users unique users. (Project: ${projectId})`,
            count: totalEnqueued
        };
    } catch (error: any) {
        console.error("[AdminRefresh] Failed to trigger manual refresh:", error);
        
        // Return raw error details to identify the specific missing resource or permission
        return { 
            success: false as const, 
            error: `Firebase Error: ${error.message}${error.code ? ` (Code: ${error.code})` : ''} - Check logs for full stack.`
        };
    }
}
