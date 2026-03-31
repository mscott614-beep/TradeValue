/**
 * Bulk Enrichment Worker (High-Stability 120s Version)
 * Processes cards one-by-one with:
 * 1. 120s Gemini SDK Timeout (Client-Side)
 * 2. 5s Pre-check Breather
 * 3. Smart Error Serialization (No 'undefined')
 * 4. 20s 'Still Thinking' UI coordination
 */

// Import Gemini SDK via CDN
importScripts('https://cdn.jsdelivr.net/npm/@google/generative-ai/dist/index.min.js');

let isRunning = false;
let cardIds = [];
let currentIndex = 0;
let apiKey = null;
let currentTimeout = null;
let genAI = null;

// Pricing Bridge State
let pricingResolver = null;

self.onmessage = function(e) {
    const { type, payload } = e.data;

    switch (type) {
        case 'START_ENRICHMENT':
            console.log("[Worker] Starting high-stability enrichment.");
            cardIds = payload.cardIds;
            apiKey = payload.apiKey;
            currentIndex = 0;
            isRunning = true;
            
            // Initialize Gemini
            if (apiKey) {
                try {
                    // The CDN script usually exposes 'GoogleGenerativeAI' on the global scope
                    if (typeof GoogleGenerativeAI !== 'undefined') {
                        genAI = new GoogleGenerativeAI(apiKey);
                    } else if (self.GoogleGenerativeAI) {
                        genAI = new self.GoogleGenerativeAI(apiKey);
                    } else {
                        throw new Error("GoogleGenerativeAI SDK not found in global scope.");
                    }
                } catch (initErr) {
                    console.error("[Worker] SDK Init Error:", initErr);
                    self.postMessage({ type: 'LOG_UPDATE', payload: { message: `❌ SDK Init Error: ${initErr.message}`, type: 'error' } });
                }
            }
            
            processNextCard();
            break;

        case 'PRICING_RESULT':
            if (pricingResolver) {
                pricingResolver(payload);
                pricingResolver = null;
            }
            break;

        case 'STOP_ENRICHMENT':
            isRunning = false;
            if (currentTimeout) {
                clearTimeout(currentTimeout);
                currentTimeout = null;
            }
            break;

        case 'RESUME_ENRICHMENT':
            isRunning = true;
            processNextCard();
            break;
            
        case 'RESET_ENRICHMENT':
            isRunning = false;
            currentIndex = 0;
            cardIds = [];
            if (currentTimeout) {
                clearTimeout(currentTimeout);
                currentTimeout = null;
            }
            break;
    }
};

/**
 * Bridge for the pricing engine.
 * Sends a request to the main thread and waits for the result.
 */
async function fetchCurrentPrice(card) {
    return new Promise((resolve) => {
        pricingResolver = resolve;
        self.postMessage({ 
            type: 'GET_PRICE', 
            payload: { card } 
        });
    });
}

async function processNextCard() {
    if (!isRunning) return;

    if (currentIndex >= cardIds.length) {
        self.postMessage({ type: 'ENRICHMENT_COMPLETE' });
        isRunning = false;
        return;
    }

    const cardId = cardIds[currentIndex];
    
    // 1. Pre-check Delay (5s Breather)
    self.postMessage({ 
        type: 'LOG_UPDATE', 
        payload: { message: `⏳ Initializing Card ${currentIndex + 1}... (5s Breather)`, type: 'info' } 
    });
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
        // Request FULL card data from main thread if not already provided
        // (For this version, we'll assume the main thread provides the card object in the next step
        // OR we just request it now).
        self.postMessage({ type: 'GET_CARD_DATA', payload: { cardId } });
        
        // We need the data before proceeding. We'll reuse the pricing resolver pattern
        const cardData = await new Promise(resolve => {
            const listener = (e) => {
                if (e.data.type === 'CARD_DATA_RESULT') {
                    self.removeEventListener('message', listener);
                    resolve(e.data.payload);
                }
            };
            self.addEventListener('message', listener);
        });

        if (!cardData) throw new Error("Could not retrieve card data.");

        const isPlaceholder = !cardData.imageUrl || cardData.imageUrl.includes("picsum.photos") || cardData.imageUrl.includes("placeholder");
        const useSearch = isPlaceholder;

        // 2. Call Gemini with 120s Timeout
        self.postMessage({ 
            type: 'PROCESS_BATCH', // Maintain UI compatibility
            payload: { 
                batchIds: [cardId],
                currentIndex,
                total: cardIds.length,
                message: `Searching Grounding for ${cardData.title}...`
            } 
        });

        if (!genAI) throw new Error("Gemini API Key missing or SDK not loaded.");

        // Requested 120s timeout configuration
        const model = genAI.getGenerativeModel(
            { model: "gemini-3.1-flash-lite-preview" },
            { timeout: 120000 }
        );

        const prompt = `Find metadata for this trading card: "${cardData.title}".
        Manufacturer (brand), Set Name, Year, Card Number.
        ${useSearch ? 'Also find a high-res image URL.' : 'Image exists, skip search.'}
        Return JSON.`;

        // Start 'Still Thinking' timer
        const heartbeat = setTimeout(() => {
            self.postMessage({ 
                type: 'LOG_UPDATE', 
                payload: { message: `🔍 [Still Thinking...] Search Grounding usually takes 30-40s`, type: 'info' } 
            });
        }, 20000);

        const result = await model.generateContent(prompt);
        clearTimeout(heartbeat);
        const response = await result.response;
        const text = response.text();
        
        // Minimal JSON extraction
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("AI returned invalid data format.");
        const aiOutput = JSON.parse(jsonMatch[0]);

        // 3. Call Pricing Bridge
        const priceResult = await fetchCurrentPrice({ ...cardData, ...aiOutput });

        // 4. Post Result to Main Thread for Firestore Commit
        self.postMessage({
            type: 'CARD_ENRICHED',
            payload: {
                cardId,
                title: cardData.title,
                metadata: aiOutput,
                price: priceResult.success ? priceResult.newPrice : cardData.currentMarketValue,
                success: true,
                log: `✅ ${cardData.title} enriched.${!useSearch ? ' (Search skipped)' : ''}`
            }
        });

        currentIndex++;
        processNextCard();

    } catch (err) {
        console.error("[Worker Error]", err);
        // Robust Error Serialization (Fix for 'undefined')
        const errorMessage = err.message || (typeof err === 'string' ? err : JSON.stringify(err)) || 'Request Timed Out';
        
        self.postMessage({
            type: 'CARD_ERROR',
            payload: {
                cardId,
                error: errorMessage,
                log: `❌ Error: ${errorMessage}`
            }
        });

        currentIndex++;
        processNextCard();
    }
}
