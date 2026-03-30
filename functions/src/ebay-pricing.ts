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

const NEGATIVE_BASE_KEYWORDS = [
    '-parallel', '-refractor', '-silver', '-prizm', '-auto', '-jersey', 
    '-patch', '-jumbo', '-glossy', '-portraits', '-ahl', '-canvas', '-sticker'
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

    const isYoungGuns = combinedText.includes('young guns');
    const parallelTerm = isYoungGuns ? '"Young Guns"' : (card.parallel && card.parallel.toLowerCase() !== 'base' ? card.parallel : '');

    const subsetExclusions = '-portraits -ahl -glossy -canvas -sticker';

    if (!hasFeature) {
        // Base Card Logic
        let query = `${year} ${brand} ${player} ${cardNumber} ${NEGATIVE_BASE_KEYWORDS.join(' ')}`.trim();
        if (!isGraded) {
             query += ` ${RAW_EXCLUSIONS.join(' ')}`;
        }
        return { type: 'Base', query };
    } else {
        // Parallel Logic
        let query = `${year} ${brand} ${player} ${parallelTerm} ${cardNumber} ${subsetExclusions} -sold -completed`.trim();
        if (!isGraded) {
             query += ` ${RAW_EXCLUSIONS.join(' ')}`;
        }
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
    
    if (processedItems.length === 0) {
        processedItems = items;
    }

    const sortedPrices = processedItems
        .map(i => parseFloat(i.price?.value || '0'))
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);

    if (sortedPrices.length === 0) return { value: 0, outliersCount: 0, logic: 'No valid prices' };

    let floorPool = sortedPrices.slice(0, 3);
    
    let outliersCount = 0;
    if (floorPool.length >= 2) {
        const initialCount = floorPool.length;
        floorPool = floorPool.filter((p, index) => {
            const others = floorPool.filter((_, i) => i !== index);
            const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
            const isScam = p < (avgOthers * 0.5);
            if (isScam) outliersCount++;
            return !isScam;
        });
        
        if (outliersCount > 0 && sortedPrices.length > initialCount) {
            const refill = sortedPrices.slice(initialCount, initialCount + outliersCount);
            floorPool.push(...refill);
            floorPool.sort((a, b) => a - b);
        }
    }

    if (floorPool.length === 0) return { value: 0, outliersCount, logic: 'All items marked as outliers' };

    const mid = Math.floor(floorPool.length / 2);
    const median = floorPool.length % 2 !== 0 
        ? floorPool[mid] 
        : (floorPool[mid - 1] + floorPool[mid]) / 2;

    return { 
        value: median, 
        outliersCount, 
        logic: `Median of ${floorPool.length} lowest items. ${outliersCount} outliers rejected.`
    };
}
