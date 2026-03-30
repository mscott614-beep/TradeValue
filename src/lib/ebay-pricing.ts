/**
 * Unified eBay Pricing Logic [Lead Data Architect Specification v1.1]
 * Ground Truth: MARKET_ENGINE_SPEC.md
 * Anchored by: src/lib/ebay-pricing.test.ts
 */

export interface CardDescriptor {
    year?: string;
    brand?: string;
    player?: string;
    cardNumber?: string;
    parallel?: string;
    title?: string;
}

const TRUE_PARALLEL_KEYWORDS = [
    'silver', 'prizm', 'refractor', 'holo', '/#', 'auto', 'patch', 
    'mojo', 'cracked ice', 'atomic', 'superfractor', 'young guns', 
    'canvas', 'jumbo', 'glossy', 'rookie card', 'rc', 'parallel',
    'numbered', 'variation', 'short print', 'sp', 'ssp'
];

const GRADE_KEYWORDS = ['psa', 'bgs', 'sgc', 'cgc', 'graded', 'gem mt', 'mint'];


/**
 * Step 1: Classification Logic
 * Step 2: Search String Construction
 */
export function buildEbayQuery(card: CardDescriptor): { type: 'Base' | 'Parallel', query: string } {
    const parallelText = (card.parallel || '').toLowerCase();
    const titleText = (card.title || '').toLowerCase();
    const combinedText = `${parallelText} ${titleText}`;
    
    // Check if this is a "True Parallel" (a variant that changes the card type)
    const hasTrueParallel = TRUE_PARALLEL_KEYWORDS.some(k => combinedText.includes(k.toLowerCase())) || 
                           (parallelText && parallelText !== 'base' && !GRADE_KEYWORDS.some(g => parallelText.includes(g)));
    
    const year = card.year || '';
    const brand = card.brand || '';
    const player = card.player || '';
    
    // Formatting: Ensure card number has a '#' for vintage matching on eBay
    const rawNumber = (card.cardNumber || '').replace('#', '');
    const cardNumber = rawNumber ? `#${rawNumber}` : '';
    const parallel = card.parallel && card.parallel.toLowerCase() !== 'base' ? card.parallel : '';

    if (!hasTrueParallel) {
        // Base Card Query: Mandatory Negative Keywords to exclude high-value parallels
        // Added -reprint and -digital as standard protection
        const negativeKeywords = '-parallel -refractor -silver -prizm -auto -jersey -patch -reprint -digital';
        let query = `${year} ${brand} ${player} ${parallel} ${cardNumber} ${negativeKeywords}`.trim();
        return { type: 'Base', query };
    } else {
        // Parallel Query: Feature name is a mandatory inclusion
        const feature = parallel || 'insert';
        let query = `${year} ${brand} ${player} ${feature} ${cardNumber} -sold -completed -reprint -digital`.trim();
        return { type: 'Parallel', query };
    }
}


/**
 * Step 4: Value Calculation (The TradeValue Rule)
 * Identifies the "Market Floor" using the 3 lowest fixed-price listings.
 */
export function calculateTradeValue(items: any[]): { value: number, outliersCount: number, logic: string } {
    if (!items || items.length === 0) return { value: 0, outliersCount: 0, logic: 'No items found' };

    // 1. Fixed Price Priority: Prioritize FIXED_PRICE over auctions to avoid low-bid noise
    let processedItems = items.filter(i => i.buyingOptions?.includes('FIXED_PRICE'));
    
    // Fallback only if NO fixed price found
    if (processedItems.length === 0) {
        processedItems = items;
    }

    // Sort by price ascending to find the "Market Floor"
    const sortedPrices = processedItems
        .map(i => parseFloat(i.price?.value || '0'))
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);

    if (sortedPrices.length === 0) return { value: 0, outliersCount: 0, logic: 'No valid prices' };

    // 2. Identify the Floor: Select top 3 lowest
    let floorPool = sortedPrices.slice(0, 3);
    
    // 3. Outlier Protection: Discard any listing that is >50% lower than the average of others
    let outliersCount = 0;
    if (floorPool.length >= 2) {
        const initialPoolCount = floorPool.length;
        floorPool = floorPool.filter((p, index) => {
            const others = floorPool.filter((_, i) => i !== index);
            const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
            // Scams are typically >50% lower than the genuine floor
            const isScam = p < (avgOthers * 0.5);
            if (isScam) outliersCount++;
            return !isScam;
        });
        
        // If outliers removed, refill from next lowest if available
        if (outliersCount > 0 && sortedPrices.length > initialPoolCount) {
            const refill = sortedPrices.slice(initialPoolCount, initialPoolCount + outliersCount);
            floorPool.push(...refill);
            floorPool.sort((a, b) => a - b);
        }
    }

    if (floorPool.length === 0) return { value: 0, outliersCount, logic: 'All items marked as outliers' };

    // 4. Final TradeValue: Median of the remaining "Floor Pool"
    const mid = Math.floor(floorPool.length / 2);
    const median = floorPool.length % 2 !== 0 
        ? floorPool[mid] 
        : (floorPool[mid - 1] + floorPool[mid]) / 2;

    return { 
        value: median, 
        outliersCount, 
        logic: `Median of ${floorPool.length} lowest Fixed Price items (Floor detection). ${outliersCount} outliers rejected.`
    };
}
