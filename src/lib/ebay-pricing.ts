/**
 * Unified eBay Pricing Logic for TradeValue [Lead Data Architect Specification]
 */

export interface CardDescriptor {
    year?: string;
    brand?: string;
    player?: string;
    cardNumber?: string;
    parallel?: string;
    title?: string;
}

export interface PricingResult {
    searchType: 'Base' | 'Parallel';
    generatedQuery: string;
    valueLogicApplied: string;
    finalValue: number;
    outliersFound: number;
}

const FEATURE_KEYWORDS = [
    'silver', 'prizm', 'refractor', 'holo', '/#', 'auto', 'patch', 
    'mojo', 'cracked ice', 'atomic', 'superfractor', 'jersey', 
    'parallel', 'short print', 'sp', 'ssp', 'young guns', 'canvas',
    'jumbo', 'glossy'
];

const RAW_EXCLUSIONS = [
    '-psa', '-bgs', '-sgc', '-cgc', '-csg'
];

/**
 * Step 1 & 2: Classification and Query Construction
 */
export function buildEbayQuery(card: CardDescriptor): { type: 'Base' | 'Parallel', query: string } {
    const combinedText = `${card.parallel || ''} ${card.title || ''}`.toLowerCase();
    const hasFeature = FEATURE_KEYWORDS.some(k => combinedText.includes(k.toLowerCase())) || 
                       (card.parallel && card.parallel.toLowerCase() !== 'base');
    
    const year = card.year || '';
    const brand = card.brand || '';
    const player = card.player || '';
    const cardNumber = (card.cardNumber || '').replace('#', '');
    const isGraded = (card as any).grader && (card as any).grader !== '' && (card as any).grader !== 'Raw';

    // Identify if this is a "Young Guns" card for special quoting
    const isYoungGuns = combinedText.includes('young guns');
    const parallelTerm = isYoungGuns ? '"Young Guns"' : (card.parallel && card.parallel.toLowerCase() !== 'base' ? card.parallel : '');

    // Common exclusions for all searches to prevent subset overlap
    const subsetExclusions = '-portraits -ahl -glossy -canvas -sticker';

    if (!hasFeature) {
        // Base Card Logic - Keep it simple to avoid over-filtering vintage cards
        let query = `${year} ${brand} ${player} ${cardNumber}`.trim();
        return { type: 'Base', query };
    } else {
        // Parallel Logic - Only exclude common noise if searching for a parallel
        let query = `${year} ${brand} ${player} ${parallelTerm} ${cardNumber} -sold -completed`.trim();
        return { type: 'Parallel', query };
    }
}

/**
 * Step 4: Value Calculation (The TradeValue Rule)
 */
export function calculateTradeValue(items: any[]): { value: number, outliersCount: number, logic: string } {
    if (!items || items.length === 0) return { value: 0, outliersCount: 0, logic: 'No items found' };

    // 1. Prioritize FIXED_PRICE
    let processedItems = items.filter(i => i.buyingOptions?.includes('FIXED_PRICE'));
    
    // Fallback to all items if no fixed price (but prioritize them)
    if (processedItems.length === 0) {
        processedItems = items;
    }

    // Sort by price ascending to find the floor
    const sortedPrices = processedItems
        .map(i => parseFloat(i.price?.value || '0'))
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);

    if (sortedPrices.length === 0) return { value: 0, outliersCount: 0, logic: 'No valid prices' };

    // 2. Identify the Floor: Select top 3 lowest
    let floorPool = sortedPrices.slice(0, 3);
    
    // 3. Outlier Protection: Discard any listing that is >50% lower than the others
    // We compare each item to the average of the others in the pool
    let outliersCount = 0;
    if (floorPool.length >= 2) {
        const initialCount = floorPool.length;
        floorPool = floorPool.filter((p, index) => {
            const others = floorPool.filter((_, i) => i !== index);
            const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
            // Discard if price is >50% lower than the average of others
            const isScam = p < (avgOthers * 0.5);
            if (isScam) outliersCount++;
            return !isScam;
        });
        
        // If we removed something, try to refill from the next lowest if available
        if (outliersCount > 0 && sortedPrices.length > initialCount) {
            const refill = sortedPrices.slice(initialCount, initialCount + outliersCount);
            floorPool.push(...refill);
            // Re-sort and re-check? Keep it simple for now as per instructions.
            floorPool.sort((a, b) => a - b);
        }
    }

    if (floorPool.length === 0) return { value: 0, outliersCount, logic: 'All items marked as outliers' };

    // 4. Final TradeValue: Median of the 3 (or remaining)
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
