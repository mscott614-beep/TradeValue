"use server";

import { getAdminDb } from "@/lib/firebase-server";
import { fetchAndEncodeImageAction } from "./fetch-image";

export interface AuditResult {
    total: number;       // Total cards with external image URLs
    fixed: number;       // Dead links cleared (imageUrl → null)
    copied: number;      // Live URLs replaced with permanent base64 copy
    skipped: number;     // Already base64 / already null
}

/**
 * Returns true if a URL is an external http/https URL (not base64 / empty).
 */
function isExternalUrl(url: string | null | undefined): boolean {
    if (!url) return false;
    return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * Scans all cards for a user that have external image URLs.
 * For each:
 *   - If the URL still resolves → downloads it, stores as permanent base64
 *   - If the URL is dead / blocked  → clears imageUrl, adds MISSING_IMAGE flag
 *
 * Returns a summary of what was done.
 */
export async function auditImageLinksAction(
    userId: string,
    onProgress?: (current: number, total: number, cardTitle: string) => void
): Promise<{ success: boolean; result?: AuditResult; error?: string }> {
    try {
        const db = getAdminDb();
        const snapshot = await db
            .collection(`users/${userId}/portfolios`)
            .get();

        if (snapshot.empty) {
            return { success: true, result: { total: 0, fixed: 0, copied: 0, skipped: 0 } };
        }

        const docs = snapshot.docs;
        const externalDocs = docs.filter(doc => isExternalUrl(doc.data().imageUrl));

        const result: AuditResult = {
            total: externalDocs.length,
            fixed: 0,
            copied: 0,
            skipped: docs.length - externalDocs.length,
        };

        // Process serially to avoid overwhelming the server action runtime
        for (let i = 0; i < externalDocs.length; i++) {
            const doc = externalDocs[i];
            const data = doc.data();
            const cardTitle: string = data.title || doc.id;
            const imageUrl: string = data.imageUrl;

            console.log(`[Audit] (${i + 1}/${externalDocs.length}) Checking: ${cardTitle}`);

            const fetchResult = await fetchAndEncodeImageAction(imageUrl);

            if (fetchResult.success && fetchResult.dataUrl) {
                // Live URL — replace with permanent base64 copy
                const existingFlags: string[] = Array.isArray(data.dataFlags) ? data.dataFlags : [];
                const newFlags = existingFlags.filter((f: string) => f !== 'MISSING_IMAGE');

                await doc.ref.update({
                    imageUrl: fetchResult.dataUrl,
                    dataFlags: newFlags,
                    lastImageAudit: new Date().toISOString(),
                });
                result.copied++;
                console.log(`[Audit] ✅ Copied to base64: ${cardTitle}`);
            } else {
                // Dead URL — clear it and flag for re-enrichment
                const existingFlags: string[] = Array.isArray(data.dataFlags) ? data.dataFlags : [];
                const newFlags = Array.from(new Set([...existingFlags, 'MISSING_IMAGE']));

                await doc.ref.update({
                    imageUrl: null,
                    dataFlags: newFlags,
                    lastImageAudit: new Date().toISOString(),
                });
                result.fixed++;
                console.log(`[Audit] 🗑️ Cleared dead link for: ${cardTitle} (${fetchResult.error})`);
            }

            // Brief yield between cards to stay within function timeout limits
            await new Promise(r => setTimeout(r, 250));
        }

        return { success: true, result };

    } catch (error: any) {
        console.error("[Audit] Fatal error:", error);
        return { success: false, error: error.message || "Audit failed." };
    }
}
