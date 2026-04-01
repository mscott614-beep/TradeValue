/**
 * Unified eBay Pricing Logic [Lead Data Architect Specification v1.1]
 * Ground Truth: MARKET_ENGINE_SPEC.md
 * Anchored by: src/lib/ebay-pricing.test.ts
 */

export interface CardDescriptor {
    year?: string;
    brand?: string;
    set?: string; // e.g. "Star Rookies", "Young Guns"
    player?: string;
    cardNumber?: string;
    parallel?: string;
    title?: string;
    condition?: string; // Added for grading support
}

const TRUE_PARALLEL_KEYWORDS = [
    'silver', 'prizm', 'refractor', 'holo', '/#', 'auto', 'patch',
    'mojo', 'cracked ice', 'atomic', 'superfractor',
    'jumbo', 'glossy', 'parallel',
    'numbered', 'variation', 'short print', 'sp', 'ssp'
];

const BASE_LIKE_KEYWORDS = [
    'psa', 'bgs', 'sgc', 'cgc', 'graded', 'gem mt', 'mint',
    'young guns', 'canvas', 'rookie card', 'rc', 'rookie',
    'bccg', 'gma', 'hga', 'csa', 'isa', 'slab', 'auth'
];



const HOBBY_ABBREVIATIONS: Record<string, string> = {
    'itg be a player': 'BAP',
    'be a player': 'BAP',
    'between the pipes': 'BTP',
    'in the game': 'ITG',
    'victory': 'UD Victory',
    'sp authentic': 'SPA',
    'spx': 'SPx',
    'black diamond': 'Black Diamond',
    'ice': 'UD Ice'
};

const PARALLEL_EXCLUSIONS: Record<string, string> = {
    'gold': '-silver -bronze -base',
    'silver': '-gold -bronze -base',
    'blue': '-red -green -gold -silver',
    'emerald': '-ruby -sapphire -gold -silver',
    'ruby': '-emerald -sapphire -gold -silver',
    'sapphire': '-emerald -ruby -gold -silver'
};

/**
 * Step 1: Classification Logic
 * Step 2: Search String Construction
 */
export function buildEbayQuery(card: CardDescriptor): { type: 'Base' | 'Parallel', query: string } {
    const parallelText = (card.parallel || '').toLowerCase();
    const conditionText = (card.condition || '').toLowerCase();
    const titleText = (card.title || '').toLowerCase();
    const combinedText = `${parallelText} ${conditionText} ${titleText}`;

    // Check if this is a "True Parallel" (a variant that changes the card type)
    const hasTrueParallel = TRUE_PARALLEL_KEYWORDS.some(k => combinedText.includes(k.toLowerCase())) ||
        (parallelText && parallelText !== 'base' && !BASE_LIKE_KEYWORDS.some(g => parallelText.includes(g)));


    const year = card.year || '';
    
    // Apply Hobby Abbreviations
    let brand = card.brand || '';
    Object.entries(HOBBY_ABBREVIATIONS).forEach(([key, val]) => {
        if (brand.toLowerCase().includes(key)) brand = val;
    });

    let setRaw = card.set || '';
    Object.entries(HOBBY_ABBREVIATIONS).forEach(([key, val]) => {
        if (setRaw.toLowerCase().includes(key)) setRaw = val;
    });

    // Smart Quoting for Sets: Quote if more than 2 words (usually a subset name like "The Mask")
    const set = setRaw.split(' ').length >= 2 ? `"${setRaw}"` : setRaw;
    
    const player = card.player || '';

    // Formatting: Ensure card number has a '#' for vintage matching on eBay
    const rawNumber = (card.cardNumber || '').replace('#', '');
    const cardNumber = rawNumber ? `#${rawNumber}` : '';
    const parallel = card.parallel && card.parallel.toLowerCase() !== 'base' ? card.parallel : '';

    // Grading Logic: Extract grade if present
    const isGraded = BASE_LIKE_KEYWORDS.some(k => conditionText.includes(k)) && /\d+/.test(conditionText);
    const gradeString = isGraded ? card.condition : '';

    // Parallel-specific exclusions (e.g. if searching 'Gold', exclude 'Silver')
    let autoExclusions = '';
    Object.entries(PARALLEL_EXCLUSIONS).forEach(([key, val]) => {
        if (parallel.toLowerCase().includes(key) || titleText.includes(key)) {
            autoExclusions = val;
        }
    });

    if (!hasTrueParallel) {
        // Base Card Query: Mandatory Negative Keywords to exclude high-value parallels
        const negativeKeywords = '-parallel -refractor -silver -prizm -auto -jersey -patch -reprint -digital';

        // If not graded, also exclude graded terms to avoid price inflation
        const gradingExclusions = !isGraded ? '-psa -bgs -sgc -cgc -graded -slab' : '';

        let query = `${gradeString} ${year} ${brand} ${set} ${player} ${parallel} ${cardNumber} ${negativeKeywords} ${gradingExclusions} ${autoExclusions}`.replace(/\s+/g, ' ').trim();
        return { type: 'Base', query };
    } else {
        // Parallel Query: Feature name is a mandatory inclusion
        const feature = parallel || 'insert';
        let query = `${gradeString} ${year} ${brand} ${set} ${player} ${feature} ${cardNumber} ${autoExclusions} -sold -completed -reprint -digital`.replace(/\s+/g, ' ').trim();
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
