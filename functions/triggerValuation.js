const { spawn } = require('child_process');
const admin = require('firebase-admin');
const path = require('path');

// Set environment variable for child processes (Python agent)
const keyPath = path.join(__dirname, '..', 'service-account.json');
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
async function runAgentForCard(userId, cardId, cardData, cardRef) {
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

    const pythonPath = 'python';
    const scriptPath = path.join(__dirname, '../market_watcher_agent.py');

    console.log(`[Watcher] Starting Python agent for ${cardDetails.player}...`);

    return new Promise((resolve, reject) => {
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

        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            const errorOutput = data.toString();
            if (!errorOutput.includes('Warning') && !errorOutput.includes('deprecated')) {
                console.error(`[Python Error]: ${errorOutput.trim()}`);
            }
        });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                return reject(`Python process exited with code ${code}`);
            }

            try {
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

                cleanedData.forEach(line => {
                    if (line.startsWith('[Python]')) {
                        console.log(line);
                    }
                });

                const jsonStr = cleanedData.filter(line => !line.startsWith('[Python]')).join('\n');
                const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    return reject(`No JSON output found from agent. Raw output: ${dataString}`);
                }

                const result = JSON.parse(jsonMatch[0]);

                let newPrice = result.final_price;
                if (typeof newPrice === 'string') {
                    newPrice = parseFloat(newPrice.replace(/[^0-9.]/g, ''));
                }

                if (isNaN(newPrice) || typeof newPrice !== 'number') {
                    newPrice = 0.99; // Default floor
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

                await cardRef.update(updateData);

                console.log(`[Watcher] Firestore updated for ${cardId} with price $${newPrice}`);
                resolve(result);

            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * Triggers the Python Market Watcher Agent and updates Firestore.
 * Supports both Single Card and Bulk Mode.
 */
async function triggerValuation(userId, cardId = null) {
    const sanitizedUserId = userId.replace(/^user_/, '').trim();
    let finalUserId = sanitizedUserId;

    // Resolve User
    const userRef = db.doc(`users/${sanitizedUserId}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        console.log(`[Watcher] User ${sanitizedUserId} not found. Attempting case-insensitive lookup...`);
        const usersList = await db.collection('users').get();
        const matchingUser = usersList.docs.find(d => d.id.toLowerCase() === sanitizedUserId.toLowerCase());

        if (matchingUser) {
            finalUserId = matchingUser.id;
            console.log(`[Watcher] Resolved correct User ID: ${finalUserId}`);
        } else {
            throw new Error(`User ${sanitizedUserId} not found.`);
        }
    }

    if (cardId) {
        // SINGLE CARD MODE
        console.log(`[Watcher] Single Card Mode: ${cardId}`);
        const tempRef = db.doc(`users/${finalUserId}/portfolios/${cardId}`);
        let targetRef = tempRef;
        let snap = await tempRef.get();

        if (!snap.exists) {
            const q = await db.collection(`users/${finalUserId}/portfolios`)
                .where('cardId', '==', cardId)
                .limit(1)
                .get();
            if (q.empty) throw new Error(`Card ${cardId} not found.`);
            targetRef = q.docs[0].ref;
            snap = q.docs[0];
        }

        return await runAgentForCard(finalUserId, cardId, snap.data(), targetRef);
    } else {
        // BULK MODE
        console.log(`[Bulk] Starting bulk refresh for user ${finalUserId}...`);
        const portfolioColl = db.collection(`users/${finalUserId}/portfolios`);
        const snapshot = await portfolioColl.get();

        if (snapshot.empty) {
            console.log("[Bulk] No cards found in portfolio.");
            return;
        }

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

        console.log(`[Bulk] Batch Separation: ${gradedCards.length} Graded, ${rawCards.length} Raw.`);

        let processedCount = 0;
        const totalToProcess = allDocs.length;

        // Phase 1: Process Graded First
        console.log("[Bulk] Starting Phase 1: Graded Cards...");
        for (const doc of gradedCards) {
            processedCount++;
            console.log(`[Bulk] [Graded] Processing ${processedCount}/${totalToProcess}: ${doc.data().player}...`);
            try {
                await runAgentForCard(finalUserId, doc.id, doc.data(), doc.ref);
            } catch (err) {
                console.error(`[Bulk] Error processing ${doc.id}:`, err);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Phase 2: Process Raw Cards
        console.log("[Bulk] Starting Phase 2: Raw Cards...");
        for (const doc of rawCards) {
            processedCount++;
            console.log(`[Bulk] [Raw] Processing ${processedCount}/${totalToProcess}: ${doc.data().player}...`);
            try {
                await runAgentForCard(finalUserId, doc.id, doc.data(), doc.ref);
            } catch (err) {
                console.error(`[Bulk] Error processing ${doc.id}:`, err);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        console.log(`[Bulk] Refresh complete for ${finalUserId}.`);
    }
}

// CLI Support
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log("Usage: node triggerValuation.js <userId> [cardId]");
        process.exit(1);
    }

    const userId = args[0];
    const cardId = args[1] || null; // Optional

    triggerValuation(userId, cardId).catch(err => {
        console.error("[Watcher] FATAL:", err);
        process.exit(1);
    });
}

module.exports = { triggerValuation };
