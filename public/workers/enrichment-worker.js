/**
 * Bulk Enrichment Worker (Serial Reliability Version)
 * Processes cards one-by-one with a mandatory 5s delay to stay under grounding limits.
 */

let isRunning = false;
let cardIds = [];
let currentIndex = 0;
let batchSize = 1; // Force Serial
let delay = 5000; // Mandatory 5s Breather
let currentTimeout = null;

self.onmessage = function(e) {
    const { type, payload } = e.data;

    switch (type) {
        case 'START_ENRICHMENT':
            console.log("[Worker] Starting serial enrichment for " + payload.cardIds.length + " cards.");
            cardIds = payload.cardIds;
            // Ignore payload delay/batchSize to enforce reliability defaults
            currentIndex = 0;
            isRunning = true;
            processNextBatch();
            break;

        case 'BATCH_SUCCESS':
            if (isRunning) {
                // Wait exactly 5s before the next card
                currentTimeout = setTimeout(processNextBatch, 5000);
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
            processNextBatch();
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

function processNextBatch() {
    if (!isRunning) return;

    if (currentIndex >= cardIds.length) {
        self.postMessage({ type: 'ENRICHMENT_COMPLETE' });
        isRunning = false;
        return;
    }

    const batch = [cardIds[currentIndex]];
    
    // Notify Main Thread to process this single card
    self.postMessage({ 
        type: 'PROCESS_BATCH', 
        payload: { 
            batchIds: batch,
            currentIndex: currentIndex,
            endIndex: currentIndex + 1,
            total: cardIds.length,
            message: `Processing Card ${currentIndex + 1} of ${cardIds.length}...`
        } 
    });

    currentIndex++;
}
