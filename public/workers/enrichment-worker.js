/**
 * Bulk Enrichment Worker
 * Manages the loop and 1000ms delay to keep the UI responsive.
 */

let isRunning = false;
let cardIds = [];
let currentIndex = 0;
let delay = 1000;
let currentTimeout = null;

self.onmessage = function(e) {
    const { type, payload } = e.data;

    switch (type) {
        case 'START_ENRICHMENT':
            console.log("[Worker] Starting enrichment for " + payload.cardIds.length + " cards.");
            cardIds = payload.cardIds;
            delay = payload.delay || 1000;
            currentIndex = 0;
            isRunning = true;
            processNext();
            break;

        case 'STOP_ENRICHMENT':
            console.log("[Worker] Stopping enrichment.");
            isRunning = false;
            if (currentTimeout) {
                clearTimeout(currentTimeout);
                currentTimeout = null;
            }
            break;

        case 'RESUME_ENRICHMENT':
            console.log("[Worker] Resuming enrichment.");
            isRunning = true;
            processNext();
            break;
            
        case 'RESET_ENRICHMENT':
            console.log("[Worker] Resetting enrichment.");
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

function processNext() {
    if (!isRunning) return;

    if (currentIndex >= cardIds.length) {
        console.log("[Worker] All cards processed.");
        self.postMessage({ type: 'ENRICHMENT_COMPLETE' });
        isRunning = false;
        return;
    }

    const cardId = cardIds[currentIndex];
    
    // Notify Main Thread to process this card
    self.postMessage({ 
        type: 'PROCESS_CARD_ID', 
        payload: { 
            cardId, 
            index: currentIndex, 
            total: cardIds.length 
        } 
    });

    currentIndex++;

    // Wait for the next tick
    currentTimeout = setTimeout(processNext, delay);
}
