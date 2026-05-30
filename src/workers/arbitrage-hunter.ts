import { config } from 'dotenv';

// Ensure environment variables are loaded BEFORE imports that require them
config({ path: '.env.local' });
config({ path: '.env' });

import { getAdminDb } from '../lib/firebase-server';
import { z } from 'zod';

// Setup Genkit Structured Output Schema for Deal Validation
const DealValidatorSchema = z.object({
    isValidDeal: z.boolean().describe('True ONLY if this is the exact card, strictly matching year, brand, player, and card number, and is NOT a reprint/digital/lot/damaged.'),
    confidenceScore: z.number().min(0).max(100).describe('Confidence 0-100 that this is a valid, raw card arbitrage opportunity.'),
    reason: z.string().describe('One concise sentence explaining why this passed or failed.'),
});

async function sendSmartArbitrageNotification(deals: any[]) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
        console.warn("[Hermes] Resend API key not configured. Skipping smart email notification.");
        return;
    }
    
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    
    const htmlContent = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0b0f19; color: #e2e8f0; max-width: 650px; margin: auto; padding: 30px; border-radius: 12px; border: 1px solid #1e293b; box-shadow: 0 10px 30px rgba(0,0,0,0.4);">
    <div style="text-align: center; margin-bottom: 25px;">
        <div style="display: inline-block; background-color: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); padding: 12px; border-radius: 50%; margin-bottom: 15px;">
            <span style="font-size: 28px;">⚡</span>
        </div>
        <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">
            Hermes Instant Profit Alerts
        </h2>
        <p style="font-size: 13px; color: #94a3b8; margin: 5px 0 0 0;">
            Live portfolio-matched arbitrage opportunities verified by Gemini AI
        </p>
    </div>
    
    <hr style="border: none; border-top: 1px solid #1e293b; margin: 20px 0;" />
    
    <div style="margin-bottom: 25px;">
        ${deals.map((d) => `
        <div style="background-color: #131a2c; border: 1px solid #1e293b; border-radius: 10px; margin-bottom: 20px; overflow: hidden; background: #131a2c;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    ${d.listingImageUrl ? `
                    <td style="width: 120px; padding: 15px; vertical-align: middle; background-color: #070a13; text-align: center;">
                        <img src="${d.listingImageUrl}" alt="${d.listingTitle}" style="max-width: 100px; max-height: 140px; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);" />
                    </td>
                    ` : ''}
                    <td style="padding: 15px; vertical-align: top;">
                        <div style="display: inline-block; background-color: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #34d399; font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 20px; margin-bottom: 8px; text-transform: uppercase;">
                            ${((d.marketValue - d.listingPrice) / d.marketValue * 100).toFixed(0)}% OFF
                        </div>
                        <h3 style="color: #ffffff; font-size: 16px; margin: 0 0 4px 0; font-weight: 700;">
                            ${d.player}
                        </h3>
                        <p style="font-size: 12px; color: #94a3b8; margin: 0 0 12px 0; font-family: monospace;">
                            ${d.title}
                        </p>
                        
                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; text-align: center;">
                            <tr>
                                <td style="background-color: #0b0f19; border: 1px solid #1e293b; border-radius: 6px; padding: 8px; width: 32%;">
                                    <div style="font-size: 9px; color: #64748b; font-weight: bold; text-transform: uppercase;">Market</div>
                                    <div style="font-size: 12px; color: #cbd5e1; font-weight: bold; font-family: monospace; margin-top: 2px;">$${d.marketValue.toFixed(2)}</div>
                                </td>
                                <td style="width: 4px;"></td>
                                <td style="background-color: #0b0f19; border: 1px solid #1e293b; border-radius: 6px; padding: 8px; width: 32%;">
                                    <div style="font-size: 9px; color: #64748b; font-weight: bold; text-transform: uppercase;">eBay Price</div>
                                    <div style="font-size: 12px; color: #f87171; font-weight: bold; font-family: monospace; margin-top: 2px;">$${d.listingPrice.toFixed(2)}</div>
                                </td>
                                <td style="width: 4px;"></td>
                                <td style="background-color: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 6px; padding: 8px; width: 32%;">
                                    <div style="font-size: 9px; color: #10b981; font-weight: bold; text-transform: uppercase;">Profit</div>
                                    <div style="font-size: 12px; color: #34d399; font-weight: bold; font-family: monospace; margin-top: 2px;">+$${d.potentialProfit.toFixed(2)}</div>
                                </td>
                            </tr>
                        </table>
                        
                        <div style="background-color: rgba(15, 23, 42, 0.4); border: 1px solid #1e293b; border-radius: 6px; padding: 10px; margin-bottom: 12px;">
                            <div style="font-size: 10px; font-weight: bold; color: #38bdf8; text-transform: uppercase; margin-bottom: 4px;">
                                🧠 AI Deal Analysis
                            </div>
                            <p style="font-size: 11px; color: #cbd5e1; margin: 0; line-height: 1.4; font-style: italic;">
                                "${d.aiReason}"
                            </p>
                        </div>
                        
                        <div style="text-align: right;">
                            <a href="${d.listingUrl}" target="_blank" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; font-size: 12px; font-weight: bold; padding: 8px 16px; border-radius: 6px; box-shadow: 0 4px 6px rgba(16,185,129,0.2);">
                                Buy on eBay →
                            </a>
                        </div>
                    </td>
                </tr>
            </table>
        </div>
        `).join('')}
    </div>
    
    <hr style="border: none; border-top: 1px solid #1e293b; margin: 25px 0;" />
    
    <div style="text-align: center; font-size: 11px; color: #475569;">
        TradeValue Automated Local Hermes Worker.<br/>
        This is a live alert triggered from your portfolio holdings.
    </div>
</div>
    `;

    try {
        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: "TradeValue Hermes <onboarding@resend.dev>",
                to: "mscott614@gmail.com",
                subject: `⚡ Hermes Instant Profit Alert — ${today} (${deals.length} deals)`,
                html: htmlContent
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log("[Hermes] Smart Arbitrage Email dispatched successfully:", data);
        } else {
            const errText = await response.text();
            console.error("[Hermes] Failed to send email via Resend:", errText);
        }
    } catch (error: any) {
        console.error("[Hermes] Failed to send email via Resend:", error.message);
    }
}

async function runArbitrageHunter() {
    console.log('🚀 Starting Advanced Arbitrage Hunter (Live eBay Alerts)...');
    
    // Dynamically import modules that depend on environment variables
    const { ebayService } = await import('../lib/ebay');
    const { generateWithFallback, PRIMARY_MODEL } = await import('../ai/genkit');
    
    const db = getAdminDb();
    
    // 1. Fetch all users
    const usersSnapshot = await db.collection('users').get();
    const userIds = usersSnapshot.docs.map(doc => doc.id);
    
    console.log(`Found ${userIds.length} users. Scanning portfolios...`);
    
    const foundDeals: any[] = [];
    let processedCards = 0;
    let alertsFound = 0;
    let tier1Blocks = 0;

    for (const userId of userIds) {
        // Fetch portfolio cards
        const portfolioSnapshot = await db.collection(`users/${userId}/portfolios`).get();
        
        for (const doc of portfolioSnapshot.docs) {
            const card = doc.data();
            processedCards++;
            
            // Only process cards with a known market value > $10 (to avoid penny card noise)
            if (!card.currentMarketValue || card.currentMarketValue < 10) {
                continue;
            }
            
            const targetDiscountPrice = card.currentMarketValue * 0.70;
            const searchQuery = `${card.year || ''} ${card.brand || ''} ${card.player || ''} ${card.cardNumber || ''}`.trim();
            
            console.log(`\n🔎 Scanning: ${searchQuery} (Market Value: $${card.currentMarketValue})`);
            
            try {
                // Fetch active "Buy It Now" listings (approximate using active items, includeAuctions = false)
                const ebayResults = await ebayService.searchActiveItems(searchQuery, 10, 'price', false);
                
                if (!ebayResults || !ebayResults.itemSummaries) continue;
                
                for (const listing of ebayResults.itemSummaries) {
                    const listingPriceStr = listing.price?.value;
                    if (!listingPriceStr) continue;
                    
                    const listingPrice = parseFloat(listingPriceStr);
                    
                    // ==========================================
                    // TIER 1: Programmatic Filter (Zero-Cost Shield)
                    // ==========================================
                    if (listingPrice >= targetDiscountPrice) {
                        // Discard immediately, preventing AI token spikes
                        tier1Blocks++;
                        continue;
                    }

                    // ==========================================
                    // TIER 1.5: Duplicate Listing Check
                    // ==========================================
                    const listingUrl = listing.itemWebUrl;
                    if (listingUrl) {
                        const duplicateQuery = await db.collection('arbitrage_alerts')
                            .where('listingUrl', '==', listingUrl)
                            .limit(1)
                            .get();
                        
                        if (!duplicateQuery.empty) {
                            console.log(`   ⏭️ DUPLICATE IGNORED: Listing "${listing.title}" was already alerted in a previous run.`);
                            continue;
                        }
                    }
                    
                    // ==========================================
                    // TIER 2: Gemini AI Deal Validator
                    // ==========================================
                    console.log(`   🚨 TIER 1 & 1.5 PASSED: Found new heavily discounted listing at $${listingPrice} (vs Target < $${targetDiscountPrice.toFixed(2)})`);
                    console.log(`   🧠 Invoking Gemini 3.5 Flash for verification...`);
                    
                    const prompt = `
                        You are a professional sports card authenticator and arbitrage expert.
                        
                        Target Card Specs:
                        - Year: ${card.year}
                        - Brand: ${card.brand}
                        - Player: ${card.player}
                        - Card Number: ${card.cardNumber}
                        
                        eBay Listing Being Evaluated:
                        - Title: ${listing.title}
                        - Price: $${listingPrice}
                        - Condition: ${listing.condition || 'Unknown'}
                        
                        Verify if this eBay listing is EXACTLY the target card described above.
                        REJECT (isValidDeal = false) if the title contains ANY of these poison words:
                        - Reprint, RP, Novelty, Facsimile, Digital, NFT, Custom, Patch (if target isn't a patch), Lot, Damaged, Creased.
                        - Or if it's clearly a different parallel (e.g. Target is Base, Listing is Refractor).
                    `;

                    try {
                        const aiResponse = await generateWithFallback({
                            model: PRIMARY_MODEL,
                            prompt,
                            output: { schema: DealValidatorSchema }
                        });
                        
                        const validation = aiResponse.output;
                        
                        if (validation?.isValidDeal && validation.confidenceScore > 80) {
                            console.log(`   ✅ TIER 2 PASSED! Verified Arbitrage Deal: ${validation.reason}`);
                            
                            const profit = card.currentMarketValue - listingPrice;
                            const alertDoc = {
                                cardId: doc.id,
                                userId: userId,
                                listingId: listing.itemId || '',
                                player: card.player,
                                title: card.title || searchQuery,
                                listingTitle: listing.title,
                                listingUrl: listing.itemWebUrl || '',
                                listingImageUrl: listing.image?.imageUrl || '',
                                marketValue: card.currentMarketValue,
                                listingPrice: listingPrice,
                                potentialProfit: profit,
                                confidenceScore: validation.confidenceScore,
                                aiReason: validation.reason,
                                detectedAt: new Date().toISOString(),
                                status: 'active'
                            };
                            
                            // Write to arbitrage_alerts collection
                            await db.collection('arbitrage_alerts').add(alertDoc);
                            alertsFound++;
                            
                            foundDeals.push({
                                player: card.player,
                                title: card.title || searchQuery,
                                listingTitle: listing.title,
                                listingUrl: listing.itemWebUrl || '',
                                listingImageUrl: listing.image?.imageUrl || '',
                                marketValue: card.currentMarketValue,
                                listingPrice: listingPrice,
                                potentialProfit: profit,
                                confidenceScore: validation.confidenceScore,
                                aiReason: validation.reason
                            });
                            
                        } else {
                            console.log(`   ❌ TIER 2 FAILED: AI rejected listing. Reason: ${validation?.reason}`);
                        }
                    } catch (aiError) {
                        console.error('   ⚠️ Error invoking Gemini validator:', aiError);
                    }
                }
            } catch (err) {
                console.error(`   ⚠️ Error fetching eBay data for ${searchQuery}:`, err);
            }
        }
    }
    
    console.log(`\n✅ Arbitrage Hunter Run Complete!`);
    console.log(`📊 Stats:`);
    console.log(`   - Cards Processed: ${processedCards}`);
    console.log(`   - Noise Blocked (Tier 1): ${tier1Blocks} listings`);
    console.log(`   - Validated Deals Found (Tier 2): ${alertsFound}`);
    
    if (foundDeals.length > 0) {
        console.log(`\n📬 Dispatched smart email alerts for ${foundDeals.length} verified deals!`);
        await sendSmartArbitrageNotification(foundDeals);
    }
    
    process.exit(0);
}

runArbitrageHunter().catch(console.error);
