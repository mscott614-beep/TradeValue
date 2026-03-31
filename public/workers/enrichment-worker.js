/**
 * Bulk Enrichment Worker (Batch Version)
 * Manages chunking of cards into batches of 5 and coordinates with the main thread.
 */

let isRunning = false;
let cardIds = [];
let currentIndex = 0;
let batchSize = 5;
let delay = 3000; // Increased to 3s between batches
let currentTimeout = null;

self.onmessage = function(e) {
    const { type, payload } = e.data;

    switch (type) {
        case 'START_ENRICHMENT':
            console.log("[Worker] Starting batch enrichment for " + payload.cardIds.length + " cards.");
            cardIds = payload.cardIds;
            delay = payload.batchDelay || 3000;
            batchSize = payload.batchSize || 5;
            currentIndex = 0;
            isRunning = true;
            processNextBatch();
            break;

        case 'BATCH_SUCCESS':
            if (isRunning) {
                // Wait the prescribed delay after a success before starting next batch
                currentTimeout = setTimeout(processNextBatch, delay);
            }
            break;

        case 'RETRY_ALERT':
            // Main thread informs worker that a rate limit retry is happening
            self.postMessage({ 
                type: 'PROGRESS_UPDATE', 
                payload: { 
                    message: `⚠️ Rate limit hit. Retrying in ${payload.seconds} seconds...`,
                    status: 'warning'
                } 
            });
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
            processNextBatch();
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

function processNextBatch() {
    if (!isRunning) return;

    if (currentIndex >= cardIds.length) {
        console.log("[Worker] All cards processed.");
        self.postMessage({ type: 'ENRICHMENT_COMPLETE' });
        isRunning = false;
        return;
    }

    const end = Math.min(currentIndex + batchSize, cardIds.length);
    const batch = cardIds.slice(currentIndex, end);
    const batchRangeText = `(Cards ${currentIndex + 1} - ${end} of ${cardIds.length})`;

    console.log(`[Worker] Processing Batch: ${batchRangeText}`);
    
    // Notify Main Thread to process this batch
    self.postMessage({ 
        type: 'PROCESS_BATCH', 
        payload: { 
            batchIds: batch,
            currentIndex: currentIndex,
            endIndex: end,
            total: cardIds.length,
            message: `Processing Batch of ${batch.length}... ${batchRangeText}`
        } 
    });

    currentIndex = end;
}
