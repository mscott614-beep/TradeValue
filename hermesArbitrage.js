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

function formatUsd(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '$0.00';
    return `$${n.toFixed(2)}`;
}

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

function buildEmailHtml({ today, duration, result, deals, errorMessage }) {
    let dealsHtml =
        "<p style='font-size: 14px; color: #64748b; font-style: italic;'>No significant raw-vs-graded arbitrage spreads detected in today's scan.</p>";

    if (errorMessage) {
        dealsHtml = `<p style='font-size: 14px; color: #b91c1c;'>Scan error: ${errorMessage}</p>`;
    } else if (deals.length > 0) {
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
                ${deals.map((d) => {
                    const yb = [d.year, d.brand].filter(Boolean).join(' ');
                    const desc = d.title ? d.title.replace(/\(\s*\)/g, '').trim() : (yb ? `${d.player || 'Unknown'} (${yb})` : (d.player || 'Unknown'));
                    return `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 8px; font-size: 13px; color: #0f172a;">${desc}</td>
                    <td style="padding: 10px 8px; text-align: right; font-size: 13px; color: #334155;">${formatUsd(d.rawPrice)}</td>
                    <td style="padding: 10px 8px; text-align: right; font-size: 13px; color: #334155;">${formatUsd(d.psa10Price)}</td>
                    <td style="padding: 10px 8px; text-align: right; font-size: 13px; color: #16a34a; font-weight: bold;">+${formatUsd(d.spread)}</td>
                </tr>
                `;
                }).join('')}
            </tbody>
        </table>
        `;
    }

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
            <h2 style="color: #7c3aed; margin-top: 0; display: flex; align-items: center; gap: 8px; font-size: 20px;">
                Arbitrage Scan Results (Local Hermes Worker)
            </h2>
            <p style="font-size: 14px; color: #6b7280; margin-top: -8px;">Date: ${today}</p>
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
            <p style="font-size: 15px; color: #374151;">${
                errorMessage
                    ? "The local daily arbitrage scan encountered an error."
                    : "The local daily arbitrage scan completed successfully."
            }</p>
            
            <div style="background: #f8fafc; border-radius: 6px; padding: 15px; margin-bottom: 20px; border: 1px solid #e2e8f0;">
                <table style="width: 100%;">
                    <tr>
                        <td style="color: #4b5563; font-size: 14px;">Watchlist Cards Scanned:</td>
                        <td style="text-align: right; color: #111827; font-weight: bold; font-size: 14px;">${result?.scanned || 0}</td>
                    </tr>
                    <tr>
                        <td style="color: #4b5563; font-size: 14px; padding-top: 8px;">Listings Evaluated:</td>
                        <td style="text-align: right; color: #111827; font-weight: bold; font-size: 14px; padding-top: 8px;">${result?.listingsEvaluated || 0}</td>
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
        `;
}

async function runArbitrageLocally() {
    console.log("[ArbitrageScan] Starting local Hermes arbitrage scan...");
    const startTime = Date.now();
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

    let result = { scanned: 0, signals: 0, skippedCooldown: 0, listingsEvaluated: 0 };
    let deals = [];
    let errorMessage = null;

    try {
        const { EbayService } = require('./functions/lib/ebay');
        const { runArbitrageScan } = require('./functions/lib/arbitrage-scanner');

        const ebay = new EbayService(
            process.env.EBAY_CLIENT_ID,
            process.env.EBAY_CLIENT_SECRET,
            process.env.EBAY_ENV || "production"
        );

        try {
            result = await runArbitrageScan(db, ebay, { forceFresh: true });
            console.log("[ArbitrageScan] Local run complete:", result);
        } catch (scanErr) {
            errorMessage = scanErr?.message || String(scanErr);
            console.error("[ArbitrageScan] Scan failed:", scanErr);
        }

        const nowIso = new Date().toISOString();
        try {
            const signalsSnap = await db.collection("arbitrage_signals")
                .where("qualifies", "==", true)
                .orderBy("detectedAt", "desc")
                .limit(30)
                .get();

            signalsSnap.docs.forEach((doc) => {
                const data = doc.data();
                if (data.status === "active" && (!data.expiresAt || data.expiresAt > nowIso)) {
                    deals.push({
                        title: data.title,
                        player: data.player,
                        year: data.year,
                        brand: data.brand,
                        rawPrice: data.rawMedianUsd,
                        psa10Price: data.slabMedianUsd,
                        spread: data.spreadUsd,
                    });
                }
            });
        } catch (fsErr) {
            console.error("[ArbitrageScan] Failed reading arbitrage_signals:", fsErr);
            if (!errorMessage) {
                errorMessage = fsErr?.message || String(fsErr);
            }
        }
    } catch (bootErr) {
        errorMessage = bootErr?.message || String(bootErr);
        console.error("[ArbitrageScan] Failed to boot scanner modules:", bootErr);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const subject = errorMessage
        ? `Arbitrage Scan Failed — ${today}`
        : `Arbitrage Scan Complete — ${today}`;

    try {
        await sendHermesNotification(
            subject,
            buildEmailHtml({ today, duration, result, deals, errorMessage })
        );
    } catch (emailErr) {
        console.error("[Hermes] Unexpected email dispatch error:", emailErr);
    }

    if (errorMessage && result.scanned === 0 && result.listingsEvaluated === 0) {
        process.exitCode = 1;
    }
}

runArbitrageLocally().catch(err => {
    console.error("Arbitrage scan failed:", err);
    process.exit(1);
});
