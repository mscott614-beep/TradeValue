/**
 * Bulk Enrichment Worker (ESM Module Version)
 * Ported to src/workers/ for Next.js bundling compatibility.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

let isRunning = false;
let cardIds: string[] = [];
let currentIndex = 0;
let apiKey: string | null = null;
let genAI: any = null;

// Pricing Bridge State
let pricingResolver: ((value: any) => void) | null = null;

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'START_ENRICHMENT':
            console.log("[Worker] Starting ESM Module enrichment.");
            cardIds = payload.cardIds;
            apiKey = payload.apiKey;
            currentIndex = 0;
            isRunning = true;
            
            // Initialize Gemini with Error Boundary
            if (apiKey) {
                try {
                    genAI = new GoogleGenerativeAI(apiKey);
                    console.log("[Worker] SDK Initialized successfully.");
                } catch (initErr: any) {
                    console.error("[Worker] SDK Init Error:", initErr);
                    self.postMessage({ 
                        type: 'LOG_UPDATE', 
                        payload: { message: `❌ Worker Initialization Failed: SDK not found.`, type: 'error' } 
                    });
                    isRunning = false;
                    return;
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
            break;

        case 'RESUME_ENRICHMENT':
            isRunning = true;
            processNextCard();
            break;
            
        case 'RESET_ENRICHMENT':
            isRunning = false;
            currentIndex = 0;
            cardIds = [];
            break;
    }
};

/**
 * Bridge for the pricing engine.
 */
async function fetchCurrentPrice(card: any) {
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
        // Request FULL card data from main thread
        self.postMessage({ type: 'GET_CARD_DATA', payload: { cardId } });
        
        const cardData: any = await new Promise(resolve => {
            const listener = (e: MessageEvent) => {
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
            type: 'PROCESS_BATCH', 
            payload: { 
                batchIds: [cardId],
                currentIndex,
                total: cardIds.length,
                message: `Searching Grounding for ${cardData.title}...`
            } 
        });

        if (!genAI) throw new Error("Gemini API Key missing or SDK not loaded.");

        const model = genAI.getGenerativeModel(
            { 
                model: "gemini-3.1-flash-lite-preview",
                generationConfig: { responseMimeType: "application/json" }
            },
            { timeout: 120000 }
        );

        const prompt = `Find metadata for this trading card: "${cardData.title}".
        Return a JSON object with these EXACT keys:
        - brand: Manufacturer name (e.g., Upper Deck, Topps)
        - set: Set Name (e.g., Series 1, Honor Roll)
        - year: Release Year
        - cardNumber: Card Number String
        ${useSearch ? `- imageUrl: A direct URL to a high-resolution image of the FRONT of this card.
          HOW TO FIND THE BEST IMAGE:
          1. BEST: Search eBay sold listings for this card. eBay image URLs start with "https://i.ebayimg.com/" and are ALWAYS publicly accessible with no restrictions. This is the preferred source.
          2. GOOD: PWCC Marketplace (pwccmarketplace.com) or Goldin Auctions sold listings.
          3. OK: COMC (img.comc.com) or TCDB (tcdb.com) as a last resort.
          * The URL must end in .jpg, .jpeg, .png, or .webp and point directly to the image file.
          * If no image URL can be found, return null.` : ''}
        
        Strict JSON only. No markdown.`;


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
        
        // Robust JSON Parsing
        let aiOutput;
        try {
            // 1. Try direct parse (standard for JSON mode)
            aiOutput = JSON.parse(text);
        } catch (e) {
            // 2. Fallback: Clean text of markdown or extra padding
            const cleaned = text.replace(/```json|```/g, '').trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("AI returned invalid data format.");
            aiOutput = JSON.parse(jsonMatch[0]);
        }

        // 3. Call Pricing Bridge
        const priceResult: any = await fetchCurrentPrice({ ...cardData, ...aiOutput });

        // 4. Forward imageUrl only when search was used (don't overwrite existing images)
        const safeImageUrl: string | null = useSearch ? (aiOutput.imageUrl || null) : null;

        // 5. Post Result to Main Thread and wait for commit acknowledgment
        self.postMessage({
            type: 'CARD_ENRICHED',
            payload: {
                cardId,
                title: cardData.title,
                metadata: aiOutput,
                imageUrl: safeImageUrl,
                price: priceResult.success ? priceResult.newPrice : cardData.currentMarketValue,
                success: true,
                log: `✅ ${cardData.title} enriched.${!useSearch ? ' (Search skipped)' : ''}`
            }
        });


        // Wait for main thread to confirm the card has been committed
        // (This pause is used for image confirmation dialog)
        await new Promise<void>(resolve => {
            const listener = (e: MessageEvent) => {
                if (e.data.type === 'CARD_COMMITTED') {
                    self.removeEventListener('message', listener);
                    resolve();
                }
            };
            self.addEventListener('message', listener);
        });

        currentIndex++;
        processNextCard();

    } catch (err: any) {
        console.error("[Worker Error]", err);
        const errorMessage = err.message || "Request Timed Out";
        
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
