const { spawn } = require('child_process');
const admin = require('firebase-admin');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env.local') });

// Set environment variable for child processes (Python agent)
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

/**
 * Runs the Gemini Market Watcher Agent for a single card.
 * Returns the agent's JSON result.
 */
function runAgent(userId, cardId, cardDetails, searchQuery) {
    return new Promise((resolve, reject) => {
        const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
        const scriptPath = path.join(__dirname, 'local_value_card.py');

        const pythonProcess = spawn(pythonPath, [
            scriptPath,
            '--userId', userId,
            '--cardId', cardId,
            '--cardDetails', JSON.stringify(cardDetails),
            '--query', searchQuery
        ], {
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
                GOOGLE_CLOUD_PROJECT: 'puckvaluebak-38609945-5e85c',
                GOOGLE_CLOUD_LOCATION: 'global'
            }
        });

        let dataString = '';
        let errorString = '';

        pythonProcess.stdout.on('data', (data) => {
            const chunk = data.toString();
            dataString += chunk;
            console.log(`[Python Output] ${chunk.trim()}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            const err = data.toString();
            // Suppress warnings
            if (!err.includes('Warning') && !err.includes('deprecated')) {
                errorString += err;
                console.error(`[Python Error] ${err.trim()}`);
            }
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`Agent exited with code ${code}. ${errorString}`));
            }

            try {
                // Extract JSON from output
                const lines = dataString.split('\n').map(l => l.trim()).filter(l => l);
                let result = null;
                
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i];
                    if (line.startsWith('{') && line.endsWith('}')) {
                        try {
                            result = JSON.parse(line);
                            break;
                        } catch (e) {
                            // ignore and continue
                        }
                    }
                }

                if (!result) {
                    return reject(new Error(`No JSON output found. Raw: ${dataString}`));
                }

                resolve(result);
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * Bulk refresh logic for a specific user.
 */
async function bulkRefresh(targetUserId) {
    console.log(`[Refresh] Starting bulk refresh for user ${targetUserId}...`);

    const portfolioColl = db.collection(`users/${targetUserId}/portfolios`);
    const snapshot = await portfolioColl.get();

    if (snapshot.empty) {
        console.log("[Refresh] No cards found in portfolio.");
        return;
    }

    const totalCards = snapshot.size;
    console.log(`[Refresh] Found ${totalCards} cards to process.`);

    const batch = db.batch();
    let processedCount = 0;
    let errorCount = 0;

    const allDocs = snapshot.docs;
    const gradedCards = allDocs.filter(doc => {
        const data = doc.data();
        const grader = (data.gradingCompany || data.grader || '').toString().trim();
        const grade = (data.grade || data.estimatedGrade || '').toString().trim();
        
        // Professional slab indicators
        const isSlabCompany = /PSA|BGS|SGC|CGC|GMA|KSA|BECKETT|BCCG/i.test(grader) || /PSA|BGS|SGC|CGC|GMA|KSA|BECKETT|BCCG/i.test(grade);
        
        // Raw indicators (exclude 'null' string and other placeholders)
        const isRawLabel = /raw|none|uncertified|null|n\/a|^$/i.test(grader) || /raw|none|n\/a|^$/i.test(grade);
        
        return isSlabCompany && !isRawLabel;
    });
    const rawCards = allDocs.filter(doc => !gradedCards.includes(doc));

    console.log(`[Refresh] Batch Separation: ${gradedCards.length} Graded, ${rawCards.length} Raw.`);

    const processBatch = async (cards, batchLabel) => {
        console.log(`[Refresh] Starting ${batchLabel} Batch...`);
        for (const doc of cards) {
            const cardData = doc.data();
            const cardId = doc.id;
            const cardRef = doc.ref;

            const cardDetails = {
                year: cardData.year || '',
                brand: cardData.brand || '',
                set: cardData.set || cardData.set_name || '',
                player: cardData.player || '',
                cardNumber: cardData.cardNumber || '',
                parallel: cardData.parallel || '',
                title: cardData.title || '',
                condition: cardData.condition || '',
                grade: cardData.grade || cardData.estimatedGrade || '',
                gradingCompany: cardData.gradingCompany || cardData.grader || ''
            };

            const cardNumStr = cardDetails.cardNumber ? `#${cardDetails.cardNumber}` : '';
        const cardName = `${cardDetails.year} ${cardDetails.brand} ${cardDetails.player} ${cardNumStr}`.replace(/\s+/g, ' ').trim();
            const isGraded = (cardDetails.gradingCompany && cardDetails.gradingCompany !== 'Raw') || 
                             (cardDetails.grade && (cardDetails.grade.includes('PSA') || cardDetails.grade.includes('BGS') || cardDetails.grade.includes('SGC')));
            
            const searchQuery = isGraded 
                ? `${cardName} ${cardDetails.gradingCompany} ${cardDetails.grade} BIN Sold`
                : `${cardName} Raw BIN Sold`;

            try {
                const result = await runAgent(targetUserId, cardId, cardDetails, searchQuery);
                
                let newPrice = result.final_price;
                if (typeof newPrice === 'string') {
                    newPrice = parseFloat(newPrice.replace(/[^0-9.]/g, ''));
                }
                if (isNaN(newPrice) || typeof newPrice !== 'number') {
                    newPrice = 0.99;
                }

                // Sticky Valuation Guard: Don't let a failed agent overwrite a valid price with $0.00
                if ((newPrice === 0 || newPrice === 0.0) && cardData.currentMarketValue > 0) {
                    console.log(`[Refresh] Agent returned 0.00. Preserving existing value of ${cardData.currentMarketValue} for ${cardId}`);
                    newPrice = cardData.currentMarketValue;
                }

                const updateData = {
                    currentMarketValue: newPrice,
                    lastMarketValueUpdate: new Date().toISOString(),
                    watcher_alert: result.alert_status || null,
                    is_10_percent_diff: result.is_10_percent_diff || false,
                    lastSearchQuery: result.last_search_query || null,
                    valuationMethod: result.valuation_method || 'Unknown',
                    data_source: 'GEMINI_WATCHER_AGENT'
                };

                if (result.price_raw_nm) updateData.price_raw_nm = result.price_raw_nm;
                if (result.price_raw_ex) updateData.price_raw_ex = result.price_raw_ex;

                batch.update(cardRef, updateData);

                processedCount++;
                console.log(`[Refresh] [${batchLabel}] Updated ${processedCount} of ${totalCards}... (Card: ${cardDetails.player})`);

            } catch (err) {
                console.error(`[Refresh] [${batchLabel}] Error processing ${cardId}:`, err.message);
                errorCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 3000)); // Increased to 3s for Free Tier compliance (20 RPM)
        }
    };

    await processBatch(gradedCards, 'Graded');
    await processBatch(rawCards, 'Raw');


    console.log(`[Refresh] All cards processed. Committing ${processedCount} updates to Firestore...`);
    await batch.commit();
    console.log(`[Refresh] Bulk refresh complete. Success: ${processedCount}, Failures: ${errorCount}`);

    // Send Hermes email notification upon completion
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

    await sendHermesNotification(
        `⚡ Morning Market Refresh Complete — ${today}`,
        `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
            <h2 style="color: #2563eb; margin-top: 0; display: flex; align-items: center; gap: 8px; font-size: 20px;">
                ⚡ Morning Market Refresh (Local Hermes Worker)
            </h2>
            <p style="font-size: 14px; color: #6b7280; margin-top: -8px;">Date: ${today}</p>
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
            <p style="font-size: 15px; color: #374151;">Your local bulk market refresh successfully completed.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px;">
                <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 10px 0; font-weight: bold; color: #4b5563; font-size: 14px;">Successful Updates:</td>
                    <td style="padding: 10px 0; text-align: right; color: #16a34a; font-weight: bold; font-size: 14px;">${processedCount}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 10px 0; font-weight: bold; color: #4b5563; font-size: 14px;">Failures:</td>
                    <td style="padding: 10px 0; text-align: right; color: #dc2626; font-weight: bold; font-size: 14px;">${errorCount}</td>
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

// Execution
const USER_ID = 'x6PdMgJJrUP6rGOAqC2zaJd6dRI3';
bulkRefresh(USER_ID).catch(err => {
    console.error("[Refresh] FATAL ERROR:", err);
});
