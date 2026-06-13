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
        await axios.post(
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
        console.log("[Hermes] Email dispatched successfully.");
    } catch (error) {
        console.error("[Hermes] Failed to send email via Resend:", error?.response?.data || error.message);
    }
}

async function runLocalMarketRefresh() {
    console.log("[MarketRefresh] Starting local daily market refresh...");
    const startTime = Date.now();
    
    const maxDailyRefresh = parseInt(process.env.MAX_DAILY_REFRESH_ENQUEUES || "50", 10);
    const agentBase = (process.env.AGENT_SERVICE_URL || "http://localhost:8082").trim();
    const refreshUrl = `${agentBase}/value-card`;
    
    console.log(`[MarketRefresh] Target agent endpoint: ${refreshUrl}`);
    console.log(`[MarketRefresh] Refresh cap limit: ${maxDailyRefresh} cards/day`);

    // 1. Fetch all candidate cards across all user portfolios
    let portfoliosSnap;
    try {
        portfoliosSnap = await db.collectionGroup("portfolios").get();
    } catch (err) {
        console.error("[MarketRefresh] Failed to fetch portfolios from Firestore:", err);
        process.exit(1);
    }

    const allCards = [];
    portfoliosSnap.docs.forEach(doc => {
        const userId = doc.ref.parent.parent?.id;
        if (userId) {
            allCards.push({
                cardId: doc.id,
                userId: userId,
                data: doc.data(),
                ref: doc.ref
            });
        }
    });

    console.log(`[MarketRefresh] Total cards found in database: ${allCards.length}`);

    // 2. Separate into Pass A (Priority: Unpriced / Zero) and Pass B (Stale: older than 24h)
    const passATasks = [];
    const passBTasks = [];
    const passAIds = new Set();
    
    const REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    const staleTimeMs = Date.now() - REFRESH_COOLDOWN_MS;

    for (const card of allCards) {
        const val = card.data.currentMarketValue;
        const lastUpdate = card.data.lastMarketValueUpdate || card.data.last_updated;
        
        // Pass A: Missing, null, or zero price
        const isUnpriced = val === undefined || val === null || val === 0 || val === 0.01 || !lastUpdate;
        
        if (isUnpriced) {
            passATasks.push(card);
            passAIds.add(card.cardId);
        } else {
            // Pass B: Stale price (older than 24h)
            try {
                const lastUpdateMs = new Date(lastUpdate).getTime();
                if (lastUpdateMs < staleTimeMs) {
                    passBTasks.push(card);
                }
            } catch (e) {
                passBTasks.push(card);
            }
        }
    }

    // Sort Pass B Tasks by last update time (oldest first) so we prioritize the most stale cards
    passBTasks.sort((a, b) => {
        const timeA = new Date(a.data.lastMarketValueUpdate || a.data.last_updated || 0).getTime();
        const timeB = new Date(b.data.lastMarketValueUpdate || b.data.last_updated || 0).getTime();
        return timeA - timeB;
    });

    // Cap Pass B tasks based on remaining daily refresh budget
    const passBCap = Math.max(0, maxDailyRefresh - passATasks.length);
    const passBCapped = passBTasks.slice(0, passBCap);

    const finalQueue = [...passATasks, ...passBCapped];
    console.log(`[MarketRefresh] Pass A (Missing/Zero Priority): ${passATasks.length} cards.`);
    console.log(`[MarketRefresh] Pass B Eligible (Stale): ${passBTasks.length} cards. Capped to: ${passBCapped.length}`);
    console.log(`[MarketRefresh] Total queue size to process: ${finalQueue.length} cards.`);

    if (finalQueue.length === 0) {
        console.log("[MarketRefresh] All cards are fresh and priced. Nothing to sync.");
        process.exit(0);
    }

    let successCount = 0;
    let failedCount = 0;

    for (let index = 0; index < finalQueue.length; index++) {
        const task = finalQueue[index];
        const { cardId, userId, data } = task;
        
        const isNewCard = !data.lastMarketValueUpdate;
        console.log(`\n[MarketRefresh] [${index + 1}/${finalQueue.length}] Refreshing card: ${data.year || ''} ${data.brand || ''} ${data.player || 'Unknown'} (User: ${userId}, Card: ${cardId})...`);

        try {
            const response = await axios.post(
                refreshUrl,
                {
                    userId: userId,
                    cardId: cardId,
                    deepSearch: isNewCard,
                    cardDetails: data
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 240000 // 4 minute timeout per card valuation
                }
            );

            if (response.data && response.data.currentMarketValue !== undefined) {
                const newPrice = response.data.currentMarketValue;
                console.log(`[MarketRefresh] SUCCESS: Valued at $${newPrice} via ${response.data.method || 'agent'}`);
                successCount++;
            } else {
                console.warn(`[MarketRefresh] WARNING: Empty or invalid response for card ${cardId}`);
                failedCount++;
            }
        } catch (err) {
            console.error(`[MarketRefresh] ERROR: Valuation failed for card ${cardId}:`, err.message);
            failedCount++;
        }

        // 3-second delay between cards to respect local LLM / ngrok rate-limiting limits
        if (index < finalQueue.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[MarketRefresh] Sync completed in ${duration}s. Success: ${successCount}, Failures: ${failedCount}`);

    // Send status report email
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

    await sendHermesNotification(
        `⚡ Local Daily Market Refresh Complete — ${today}`,
        `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
            <h2 style="color: #2563eb; margin-top: 0; display: flex; align-items: center; gap: 8px; font-size: 20px;">
                ⚡ Daily Market Refresh (Local K12 PC)
            </h2>
            <p style="font-size: 14px; color: #6b7280; margin-top: -8px;">Date: ${today}</p>
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
            <p style="font-size: 15px; color: #374151;">Your local daily market refresh task has finished execution.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px;">
                <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 10px 0; font-weight: bold; color: #4b5563; font-size: 14px;">Successful Refreshes:</td>
                    <td style="padding: 10px 0; text-align: right; color: #16a34a; font-weight: bold; font-size: 14px;">${successCount}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 10px 0; font-weight: bold; color: #4b5563; font-size: 14px;">Failed Refreshes:</td>
                    <td style="padding: 10px 0; text-align: right; color: ${failedCount > 0 ? '#dc2626' : '#4b5563'}; font-weight: bold; font-size: 14px;">${failedCount}</td>
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

runLocalMarketRefresh().catch(err => {
    console.error("[MarketRefresh] Fatal error:", err);
    process.exit(1);
});
