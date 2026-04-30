const { spawn } = require('child_process');
const admin = require('firebase-admin');
const path = require('path');

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

/**
 * Runs the Gemini Market Watcher Agent for a single card.
 * Returns the agent's JSON result.
 */
function runAgent(userId, cardId, cardDetails, searchQuery) {
    return new Promise((resolve, reject) => {
        const pythonPath = 'python';
        const scriptPath = path.join(__dirname, 'market_watcher_agent.py');

        const pythonProcess = spawn(pythonPath, [
            scriptPath,
            '--userId', userId,
            '--cardId', cardId,
            '--cardDetails', JSON.stringify(cardDetails),
            '--query', searchQuery
        ], {
            env: {
                ...process.env,
                GOOGLE_CLOUD_PROJECT: 'puckvaluebak-38609945-5e85c',
                GOOGLE_CLOUD_LOCATION: 'global'
            }
        });

        let dataString = '';
        let errorString = '';

        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            const err = data.toString();
            // Suppress warnings
            if (!err.includes('Warning') && !err.includes('deprecated')) {
                errorString += err;
            }
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`Agent exited with code ${code}. ${errorString}`));
            }

            try {
                // Extract JSON from output
                const cleanedData = dataString.split('\n')
                    .map(line => line.trim())
                    .filter(line => {
                        return line.startsWith('{') || 
                               line.startsWith('}') || 
                               line.startsWith('"') || 
                               line.startsWith(':') || 
                               line.startsWith('[') || 
                               line.startsWith(']') ||
                               line.startsWith('[Python]');
                    });
                
                // Print Python model logs and other diagnostic info to terminal
                cleanedData.forEach(line => {
                    if (line.startsWith('[Python]')) {
                        console.log(line);
                    }
                });

                const jsonStr = cleanedData.filter(line => !line.startsWith('[Python]')).join('\n');
                const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    return reject(new Error(`No JSON output found. Raw: ${dataString}`));
                }

                try {
                    const result = JSON.parse(jsonMatch[0]);
                    resolve(result);
                } catch (parseErr) {
                    console.error(`[Refresh] JSON Parse Failed for Card ${cardId}! Raw string: "${jsonMatch[0]}"`);
                    reject(parseErr);
                }
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
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    };

    await processBatch(gradedCards, 'Graded');
    await processBatch(rawCards, 'Raw');


    console.log(`[Refresh] All cards processed. Committing ${processedCount} updates to Firestore...`);
    await batch.commit();
    console.log(`[Refresh] Bulk refresh complete. Success: ${processedCount}, Failures: ${errorCount}`);
}

// Execution
const USER_ID = 'x6PdMgJJrUP6rGOAqC2zaJd6dRI3';
bulkRefresh(USER_ID).catch(err => {
    console.error("[Refresh] FATAL ERROR:", err);
});
