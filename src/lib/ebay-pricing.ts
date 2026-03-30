/**
 * Simplified eBay Pricing Logic for TradeValue
 */

export interface CardDescriptor {
    year?: string;
    brand?: string;
    player?: string;
    cardNumber?: string;
    parallel?: string;
    title?: string;
}

/**
 * Step 1: Clean, Broad Query Construction
 */
export function buildEbayQuery(card: CardDescriptor): { type: 'Base' | 'Parallel', query: string } {
    const year = card.year || '';
    const brand = card.brand || '';
    const player = card.player || '';
    // Re-add the # prefix as most vintage cards use it on eBay
    const cardNumber = card.cardNumber ? (card.cardNumber.startsWith('#') ? card.cardNumber : `#${card.cardNumber}`) : '';
    
    const isParallel = card.parallel && card.parallel.toLowerCase() !== 'base' && card.parallel.toLowerCase() !== 'standard';
    const type = isParallel ? 'Parallel' : 'Base';
    
    // Simple, broad search query
    let query = `${year} ${brand} ${player} ${isParallel ? card.parallel : ''} ${cardNumber}`.replace(/\s+/g, ' ').trim();
    
    return { type, query };
}

/**
 * Step 2: Simple Median-Based Pricing
 */
export function calculateTradeValue(items: any[]): { value: number, outliersCount: number, logic: string } {
    if (!items || items.length === 0) return { value: 0, outliersCount: 0, logic: 'No items found' };

    const prices = items
        .map(i => parseFloat(i.price?.value || '0'))
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);

    if (prices.length === 0) return { value: 0, outliersCount: 0, logic: 'No valid prices' };

    // Simply take the median of all active listings found
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 !== 0 
        ? prices[mid] 
        : (prices[mid - 1] + prices[mid]) / 2;

    return { 
        value: median, 
        outliersCount: 0, 
        logic: `Median of ${prices.length} active listings.`
    };
}
