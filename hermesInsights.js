const admin = require('firebase-admin');
const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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
const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("[HermesInsights] ERROR: Missing Gemini API Key in .env.local.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function sendHermesNotification(subject, htmlContent) {
    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    if (!resendApiKey) {
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
                    Authorization: `Bearer ${resendApiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );
        console.log("[Hermes] Email dispatched successfully:", response.data);
    } catch (error) {
        console.error("[Hermes] Failed to send email via Resend:", error?.response?.data || error.message);
    }
}

async function generateInsightsWithFallback(prompt) {
    const localLlmUrl = process.env.LOCAL_LLM_URL || 'https://primary-villain-parking.ngrok-free.dev';
    const localLlmModel = process.env.LOCAL_LLM_MODEL || 'gemma4:26b';

    console.log(`[Hermes] Synthesizing portfolio data using LOCAL OLLAMA (${localLlmModel})...`);
    try {
        const response = await axios({
            method: 'post',
            url: `${localLlmUrl}/api/generate`,
            data: {
                model: localLlmModel,
                prompt: prompt,
                stream: true
            },
            responseType: 'stream',
            timeout: 600000 // 10 minute timeout just in case
        });

        let fullText = '';
        let buffer = '';
        return new Promise((resolve, reject) => {
            response.data.on('data', (chunk) => {
                buffer += chunk.toString();
                let newlineIndex = buffer.indexOf('\n');
                while (newlineIndex !== -1) {
                    const line = buffer.slice(0, newlineIndex).trim();
                    buffer = buffer.slice(newlineIndex + 1);
                    if (line) {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.response) {
                                fullText += parsed.response;
                            }
                        } catch (e) {
                            // Ignore
                        }
                    }
                    newlineIndex = buffer.indexOf('\n');
                }
            });

            response.data.on('end', () => resolve(fullText));
            response.data.on('error', reject);
        });

    } catch (error) {
        console.error(`[Hermes] Local Ollama failed: ${error.message}`);
        throw error;
    }
}

async function runPortfolioInsights() {
    console.log("🚀 Starting Local Hermes AI Weekly Portfolio Insights...");
    
    // 1. Fetch all users
    const usersSnapshot = await db.collection('users').get();
    
    for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userEmail = userDoc.data().email || "mscott614@gmail.com";
        
        // Skip user if email is not the target canonical email
        if (userEmail !== "mscott614@gmail.com") continue;
        
        console.log(`Analyzing portfolio for user: ${userEmail}...`);
        
        // 2. Fetch current portfolio holdings
        const portfolioSnapshot = await db.collection(`users/${userId}/portfolios`).get();
        if (portfolioSnapshot.empty) {
            console.log(`Portfolio is empty for user ${userEmail}. Skipping.`);
            continue;
        }
        
        const cards = [];
        let totalValue = 0;
        
        portfolioSnapshot.docs.forEach(doc => {
            const card = doc.data();
            const value = card.currentMarketValue || 0;
            totalValue += value;
            cards.push({
                player: card.player,
                title: card.title || `${card.year} ${card.brand} ${card.player}`,
                year: card.year,
                brand: card.brand,
                cardNumber: card.cardNumber,
                condition: card.condition,
                currentMarketValue: value,
                purchasePrice: card.purchasePrice || 0
            });
        });
        
        // 3. Fetch last 7 days of snapshot history
        const historySnapshot = await db.collection(`portfolios/${userId}/history`)
            .orderBy('timestamp', 'desc')
            .limit(7)
            .get();
            
        const snapshots = [];
        historySnapshot.docs.forEach(doc => {
            const snap = doc.data();
            snapshots.push({
                date: doc.id,
                totalValue: snap.totalValue || 0,
                cardCount: snap.cardCount || 0,
                netChange: snap.netChange || 0
            });
        });
        
        // Sort cards to get the most valuable one for analysis
        cards.sort((a, b) => (b.currentMarketValue || 0) - (a.currentMarketValue || 0));
        const topCard = cards[0];

        // Ensure variables map dynamically to the card data object
        const prompt = `
You are an expert trading card appraiser and market analyst. I am going to provide you with the details of a trading card. 

Card Details:
- Player/Character: ${topCard.player} 
- Year & Set: ${topCard.year} ${topCard.brand}
- Condition/Grade: ${topCard.condition}
- Recent eBay Sales Data: Current Est. Value $${topCard.currentMarketValue}

Based on this information, please provide a concise market analysis formatted strictly as JSON with the following keys:
1. "estimated_value_range": Your estimated price range in USD.
2. "market_trend": A short sentence on whether the card's value is trending up, down, or stable.
3. "key_features": 2-3 bullet points on what makes this specific card valuable (e.g., rookie year, foil, specific athlete milestones).
4. "investment_rating": A rating from 1 to 10 on its long-term hold value.

Do not include any other conversational text outside of the JSON block.
`;

        const aiResponseText = await generateInsightsWithFallback(prompt);
        
        console.log("[Hermes] Raw AI Response:\n", aiResponseText);
        
        let parsedAnalysis = {};
        try {
            // Strip any markdown formatting the model might have added
            const cleanJsonText = aiResponseText
                .replace(/```json/gi, '')
                .replace(/```/g, '')
                .trim();
                
            parsedAnalysis = JSON.parse(cleanJsonText);
            console.log("[Hermes] Parsed Analysis Object:\n", JSON.stringify(parsedAnalysis, null, 2));
        } catch (e) {
            console.error("Failed to parse JSON response:", aiResponseText);
            parsedAnalysis = {
                market_trend: "Data unavailable",
                estimated_value_range: "Data unavailable",
                key_features: "Data unavailable",
                investment_rating: "N/A"
            };
        }
            
        // Format key features nicely as bullet points
        let keyFeaturesHtml = '';
        if (Array.isArray(parsedAnalysis.key_features)) {
            keyFeaturesHtml = `<ul style="margin: 0; padding-left: 20px; line-height: 1.6; color: #cbd5e1;">` + 
                parsedAnalysis.key_features.map(feat => `<li style="margin-bottom: 8px;">${feat}</li>`).join('') + 
                `</ul>`;
        } else if (typeof parsedAnalysis.key_features === 'string') {
            keyFeaturesHtml = `<p style="margin: 0; line-height: 1.6; color: #cbd5e1;">${parsedAnalysis.key_features}</p>`;
        } else {
            keyFeaturesHtml = `<p style="margin: 0; line-height: 1.6; color: #94a3b8;">Data unavailable</p>`;
        }
            
        // 6. Wrap in a standard Hermes newsletter envelope
        const envelope = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0b0f19; color: #e2e8f0; max-width: 650px; margin: auto; padding: 30px; border-radius: 12px; border: 1px solid #1e293b; box-shadow: 0 10px 30px rgba(0,0,0,0.4);">
    <div style="text-align: center; margin-bottom: 25px;">
        <div style="display: inline-block; background-color: rgba(124, 58, 237, 0.1); border: 1px solid rgba(124, 58, 237, 0.2); padding: 12px; border-radius: 50%; margin-bottom: 15px;">
            <span style="font-size: 28px;">🔮</span>
        </div>
        <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">
            Hermes Portfolio Intelligence
        </h2>
        <p style="font-size: 13px; color: #94a3b8; margin: 5px 0 0 0;">
            Featured Card Analysis: ${topCard.player} (${topCard.year})
        </p>
    </div>
    
    <hr style="border: none; border-top: 1px solid #1e293b; margin: 20px 0;" />
    
    <div>
        <h3 style="color: #a78bfa; font-size: 16px; font-weight: 600; margin-top: 20px; margin-bottom: 8px;">Market Trend</h3>
        <p style="margin: 0 0 16px 0; line-height: 1.6; color: #cbd5e1;">${parsedAnalysis.market_trend || "Data unavailable"}</p>
        
        <h3 style="color: #a78bfa; font-size: 16px; font-weight: 600; margin-top: 20px; margin-bottom: 8px;">Estimated Value Range</h3>
        <p style="margin: 0 0 16px 0; line-height: 1.6; color: #cbd5e1; font-weight: 600; font-size: 18px;">${parsedAnalysis.estimated_value_range || "Data unavailable"}</p>
        
        <h3 style="color: #a78bfa; font-size: 16px; font-weight: 600; margin-top: 20px; margin-bottom: 8px;">Key Features</h3>
        <div style="margin-bottom: 16px;">${keyFeaturesHtml}</div>
        
        <h3 style="color: #a78bfa; font-size: 16px; font-weight: 600; margin-top: 20px; margin-bottom: 8px;">Investment Rating</h3>
        <p style="margin: 0 0 16px 0; line-height: 1.6; color: #cbd5e1;"><strong style="font-size: 20px; color: #38bdf8;">${parsedAnalysis.investment_rating || "N/A"}</strong> <span style="color: #64748b;">/ 10</span></p>
    </div>
    
    <hr style="border: none; border-top: 1px solid #1e293b; margin: 25px 0;" />
    
    <div style="text-align: center; font-size: 11px; color: #475569;">
        TradeValue Automated Local Hermes Worker.<br/>
        This is a weekly scheduled intelligence brief generated locally on your PC.
    </div>
</div>
        `;
        const todayStr = new Date().toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        await sendHermesNotification(
            `🔮 Hermes Weekly Portfolio Intelligence Brief — ${todayStr}`,
            envelope
        );
        
        console.log(`Successfully compiled and dispatched weekly brief to ${userEmail}!`);
    }
    
    console.log("✅ Weekly Portfolio Insights Run Complete!");
    process.exit(0);
}

runPortfolioInsights().catch(err => {
    console.error("Weekly Portfolio Insights failed:", err);
    process.exit(1);
});
