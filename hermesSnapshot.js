const admin = require('firebase-admin');
const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '.env.local') });

// Set environment variable for service account
const keyPath = path.join(__dirname, 'service-account.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(keyPath),
        projectId: 'puckvaluebak-38609945-5e85c'
    });
}

const db = admin.firestore();

async function sendHermesNotification(subject, htmlContent) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
        console.warn("[Hermes] Resend API key not configured. Skipping email notification.");
        return;
    }
    try {
        const response = await axios.post(
            "https://api.resend.com/emails",
            {
                from: "TradeValue Hermes <onboarding@resend.dev>",
                to: "mscott614@gmail.com",
                subject: subject,
                html: htmlContent,
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );
        console.log("[Hermes] Email dispatched successfully:", response.data);
    } catch (error) {
        console.error("[Hermes] Failed to send email via Resend:", error?.response?.data || error.message);
    }
}

async function runSnapshot() {
    const startTime = Date.now();
    const todayDate = new Date();
    
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(todayDate);

    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(yesterdayDate);

    console.log(`[PriceSnapshot] Starting local daily snapshot for ${today} (yesterday was ${yesterday})`);

    const usersSnap = await db.collection("users").listDocuments();
    let totalCards = 0;

    for (const userDocRef of usersSnap) {
        const portfolioSnap = await userDocRef.collection("portfolios").get();

        const batch = db.batch();
        let batchCount = 0;
        let totalPortfolioValue = 0;

        for (const cardDoc of portfolioSnap.docs) {
            const cardData = cardDoc.data();
            const value = cardData.currentMarketValue;

            if (typeof value === "number" && value > 0) {
                totalPortfolioValue += value;

                // 1. Save history snapshot (card level)
                const historyRef = cardDoc.ref.collection("priceHistory").doc(today);

                batch.set(historyRef, {
                    value,
                    timestamp: new Date().toISOString(),
                }, { merge: true });

                batchCount++;
                totalCards++;
            }
        }

        if (totalPortfolioValue > 0) {
            const yesterdayDoc = await db
                .collection("portfolios")
                .doc(userDocRef.id)
                .collection("history")
                .doc(yesterday)
                .get();
            
            let totalValueYesterday = 0;
            if (yesterdayDoc.exists) {
                totalValueYesterday = yesterdayDoc.data()?.totalValue || 0;
            }
            const netChange = totalPortfolioValue - totalValueYesterday;

            const portfolioRootHistoryRef = db
                .collection("portfolios")
                .doc(userDocRef.id)
                .collection("history")
                .doc(today);

            batch.set(portfolioRootHistoryRef, {
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                totalValue: totalPortfolioValue,
                cardCount: portfolioSnap.size,
                netChange: netChange
            }, { merge: true });

            const portfolioHistoryRef = userDocRef.collection("portfolioHistory").doc(today);

            batch.set(portfolioHistoryRef, {
                totalValue: totalPortfolioValue,
                timestamp: new Date().toISOString(),
                cardCount: portfolioSnap.size
            }, { merge: true });

            batchCount += 2;
        }

        if (batchCount > 0) {
            await batch.commit();
        }
    }

    console.log(`[PriceSnapshot] Done. Snapshotted ${totalCards} cards for ${today}.`);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    await sendHermesNotification(
        `📸 Daily Price Snapshot Complete — ${today}`,
        `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
            <h2 style="color: #16a34a; margin-top: 0; display: flex; align-items: center; gap: 8px; font-size: 20px;">
                📸 Daily Price Snapshot Completed (Local Hermes Worker)
            </h2>
            <p style="font-size: 14px; color: #6b7280; margin-top: -8px;">Date: ${today}</p>
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
            <p style="font-size: 15px; color: #374151;">The local daily snapshot run finished successfully.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px;">
                <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 10px 0; font-weight: bold; color: #4b5563; font-size: 14px;">Total Cards Snapshotted:</td>
                    <td style="padding: 10px 0; text-align: right; color: #111827; font-weight: bold; font-size: 14px;">${totalCards}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 10px 0; color: #4b5563; font-size: 14px;">Execution Duration:</td>
                    <td style="padding: 10px 0; text-align: right; color: #111827; font-size: 14px;">${duration} seconds</td>
                </tr>
            </table>
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
            <p style="font-size: 11px; color: #9ca3af; text-align: center;">
                TradeValue Local Hermes Worker.<br/>
            </p>
        </div>
        `
    );
}

runSnapshot().catch(err => {
    console.error("Snapshot failed:", err);
    process.exit(1);
});
