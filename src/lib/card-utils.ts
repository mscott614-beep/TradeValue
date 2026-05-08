/**
 * Card Filtering & Classification Utilities
 * Centralized logic for 'Graded vs Raw' detection.
 */

/**
 * Checks if a card is professionally graded based on its grader field.
 * Uses a hybrid approach:
 * 1. Whitelist: Checks for known grading companies (PSA, BGS, etc.)
 * 2. Blacklist: Excludes keywords that indicate a raw or uncertified status.
 */
export const isGraded = (grader?: string): boolean => {
    if (!grader) return false;
    const v = grader.trim().toLowerCase();
    
    // Priority 1: Known Professional Graders (Whitelist)
    const knownGraders = [
        'psa', 'bgs', 'sgc', 'cgc', 'bccg', 'gma', 'hga', 
        'ksa', 'mnt', 'csg', 'ags', 'scg', 'isa', 'csa', 'ace'
    ];
    if (knownGraders.some(g => v.includes(g))) return true;
    
    // Priority 2: Raw/Condition Keywords (Blacklist)
    // If it contains these, it's definitely not a slab.
    const rawKeywords = [
        'none', 'raw', 'uncertified', 'ungraded', 'loose', 'n/a', 'null',
        'binder', 'sleeve', 'excellent', 'mint', 'near mint', 
        'nm', 'ex', 'vg', 'fair', 'good', 'poor', 'played', 
        'mp', 'hp', 'lp'
    ];
    return !rawKeywords.some(kw => v.includes(kw));
};


/**
 * Strips common noise from titles to help with visual consistency in the UI.
 * Patterns: "L@@K", "STUNNING", "FIRE", "WOW", "MINT", "STARS", "INVEST"
 */
export const cleanTitle = (title: string): string => {
    if (!title) return "";
    // Regex for common hobby "spam" words in eBay titles
    const NOISE_PATTERN = /\b(L@@K|STUNNING|FIRE|WOW|MINT|STARS?|INVEST|HOT|RARE|BEAUTIFUL|BEST|AMAZING|NRMT|MT|CASE|HIT|SSP|SP|D@@K|LOOK|PULL)\b/gi;
    return title.replace(NOISE_PATTERN, "").replace(/\s+/g, " ").trim();
};


/**
 * Builds the full set name in the standard hobby format.
 * Format: {year} {brand} {subset if applicable}
 * Examples:
 *   "2013-14 Upper Deck Young Guns"
 *   "2023 Topps Chrome"
 *   "2024-25 Panini Prizm"
 *   "1987 Topps" (no subset)
 */
export const buildFullSetName = (opts: {
    year?: string;
    brand?: string;
    subset?: string;
    parallel?: string;
}): string => {
    const parts: string[] = [];

    if (opts.year) parts.push(opts.year.toString().trim());
    if (opts.brand) parts.push(opts.brand.trim());

    // If subset is missing or just "Base", use parallel as the subset info
    let finalSubset = opts.subset?.trim();
    if (!finalSubset || finalSubset.toLowerCase() === 'base' || finalSubset.toLowerCase() === (opts.brand || '').trim().toLowerCase()) {
        finalSubset = opts.parallel?.trim();
    }

    if (finalSubset) {
        const sub = finalSubset.trim();
        const brandLower = (opts.brand || '').trim().toLowerCase();
        if (sub && sub.toLowerCase() !== 'base' && sub.toLowerCase() !== brandLower) {
            parts.push(sub);
        }
    }

    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || 'Unknown Set';
};


/**
 * Builds a standardized card title from metadata.
 * Format: {year} {brand} #{cardNumber} {player} {features}
 * Example: "2013-14 Upper Deck #202 Dougie Hamilton Rookie"
 */
export const buildCardTitle = (opts: {
    year?: string;
    brand?: string;
    cardNumber?: string;
    player?: string;
    features?: string[];
    parallel?: string;
    serialNumber?: string;
}): string => {
    const parts: string[] = [];

    // 1. Year
    if (opts.year) parts.push(opts.year.toString().trim());

    // 2. Brand
    if (opts.brand) parts.push(opts.brand.trim());

    // 3. Card Number (ALWAYS prefix with #)
    if (opts.cardNumber) {
        const num = opts.cardNumber.toString().replace(/^#/, '').trim();
        if (num) {
            parts.push(`#${num}`);
        }
    }

    // 4. Player name
    if (opts.player) parts.push(opts.player.trim());

    // 5. Features / Parallel / Serial
    const featureParts: string[] = [];
    
    if (opts.features && Array.isArray(opts.features)) {
        featureParts.push(...opts.features);
    }
    
    if (opts.parallel) {
        featureParts.push(opts.parallel);
    }
    
    if (opts.serialNumber) {
        let sn = opts.serialNumber.trim();
        if (sn && !sn.startsWith('/') && !sn.toLowerCase().includes('of')) {
            sn = `/${sn}`;
        }
        featureParts.push(sn);
    }

    // Add unique feature parts to title
    for (const feat of featureParts) {
        const cleanFeat = feat.trim();
        if (cleanFeat && !parts.some(p => p.toLowerCase().includes(cleanFeat.toLowerCase()))) {
            parts.push(cleanFeat);
        }
    }

    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || 'Unknown Card';
};
