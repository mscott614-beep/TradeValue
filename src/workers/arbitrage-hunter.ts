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
                    // TIER 2: Gemini AI Deal Validator
                    // ==========================================
                    console.log(`   🚨 TIER 1 PASSED: Found heavily discounted listing at $${listingPrice} (vs Target < $${targetDiscountPrice.toFixed(2)})`);
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
    process.exit(0);
}

runArbitrageHunter().catch(console.error);
