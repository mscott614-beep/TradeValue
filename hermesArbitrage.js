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

async function runArbitrageLocally() {
    console.log("[ArbitrageScan] Starting local Hermes arbitrage scan...");
    const startTime = Date.now();

    // Import compiled TS logic from the functions folder
    const { EbayService } = require('./functions/lib/ebay');
    const { runArbitrageScan } = require('./functions/lib/arbitrage-scanner');

    const ebay = new EbayService(
        process.env.EBAY_CLIENT_ID,
        process.env.EBAY_CLIENT_SECRET,
        process.env.EBAY_ENV || "production"
    );

    const result = await runArbitrageScan(db, ebay);
    console.log("[ArbitrageScan] Local run complete:", result);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

    const signalsSnap = await db.collection("arbitrage_signals")
        .where("qualifies", "==", true)
        .orderBy("detectedAt", "desc")
        .limit(15)
        .get();

    const deals = [];
    signalsSnap.docs.forEach((doc) => {
        const data = doc.data();
        deals.push({
            player: data.player,
            year: data.year,
            brand: data.brand,
            rawPrice: data.rawMedianUsd,
            psa10Price: data.slabMedianUsd,
            spread: data.spreadUsd,
        });
    });

    let dealsHtml = "<p style='font-size: 14px; color: #64748b; font-style: italic;'>No significant raw-vs-graded arbitrage spreads detected in today's scan.</p>";
    if (deals.length > 0) {
        dealsHtml = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px;">
            <thead>
                <tr style="border-bottom: 2px solid #e5e7eb; text-align: left;">
                    <th style="padding: 10px 8px; color: #475569; font-size: 13px; font-weight: bold;">Card Description</th>
                    <th style="padding: 10px 8px; text-align: right; color: #475569; font-size: 13px; font-weight: bold;">Raw Est.</th>
                    <th style="padding: 10px 8px; text-align: right; color: #475569; font-size: 13px; font-weight: bold;">PSA 10 Comps</th>
                    <th style="padding: 10px 8px; text-align: right; color: #475569; font-size: 13px; font-weight: bold;">Est. Spread</th>
                </tr>
            </thead>
            <tbody>
                ${deals.map((d) => `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 8px; font-size: 13px; color: #0f172a;">${d.player || 'Unknown'} (${d.year} ${d.brand || ''})</td>
                    <td style="padding: 10px 8px; text-align: right; font-size: 13px; color: #334155;">$${d.rawPrice}</td>
                    <td style="padding: 10px 8px; text-align: right; font-size: 13px; color: #334155;">$${d.psa10Price}</td>
                    <td style="padding: 10px 8px; text-align: right; font-size: 13px; color: #16a34a; font-weight: bold;">+$${d.spread}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        `;
    }

    await sendHermesNotification(
        `⚖️ Arbitrage Scan Complete — ${today}`,
        `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
            <h2 style="color: #7c3aed; margin-top: 0; display: flex; align-items: center; gap: 8px; font-size: 20px;">
                ⚖️ Arbitrage Scan Results (Local Hermes Worker)
            </h2>
            <p style="font-size: 14px; color: #6b7280; margin-top: -8px;">Date: ${today}</p>
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
            <p style="font-size: 15px; color: #374151;">The local daily arbitrage scan completed successfully.</p>
            
            <div style="background: #f8fafc; border-radius: 6px; padding: 15px; margin-bottom: 20px; border: 1px solid #e2e8f0;">
                <table style="width: 100%;">
                    <tr>
                        <td style="color: #4b5563; font-size: 14px;">Total Items Scanned:</td>
                        <td style="text-align: right; color: #111827; font-weight: bold; font-size: 14px;">${result?.scanned || 0}</td>
                    </tr>
                    <tr>
                        <td style="color: #4b5563; font-size: 14px; padding-top: 8px;">Arbitrage Spreads Detected:</td>
                        <td style="text-align: right; color: #7c3aed; font-weight: bold; font-size: 14px; padding-top: 8px;">${result?.signals || 0}</td>
                    </tr>
                    <tr>
                        <td style="color: #4b5563; font-size: 14px; padding-top: 8px;">Scan Duration:</td>
                        <td style="text-align: right; color: #111827; font-size: 14px; padding-top: 8px;">${duration} seconds</td>
                    </tr>
                </table>
            </div>

            <h3 style="color: #1e293b; font-size: 15px; margin-bottom: 10px;">Top Opportunities Discovered</h3>
            ${dealsHtml}

            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 25px 0;" />
            <p style="font-size: 11px; color: #9ca3af; text-align: center;">
                TradeValue Local Hermes Worker.<br/>
            </p>
        </div>
        `
    );
}

runArbitrageLocally().catch(err => {
    console.error("Arbitrage scan failed:", err);
    process.exit(1);
});
