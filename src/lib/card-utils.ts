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
}): string => {
    const parts: string[] = [];

    if (opts.year) parts.push(opts.year.toString().trim());
    if (opts.brand) parts.push(opts.brand.trim());

    // Only add subset if it's meaningful and not a repeat of the brand
    if (opts.subset) {
        const sub = opts.subset.trim();
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
 * Example: "2023 Topps Chrome #150 Shohei Ohtani Refractor /299"
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

    // Year (full season format like "2013-14")
    if (opts.year) parts.push(opts.year.toString().trim());

    // Brand
    if (opts.brand) parts.push(opts.brand.trim());

    // Card number with # prefix for pure numeric, as-is for alphanumeric
    if (opts.cardNumber) {
        const num = opts.cardNumber.toString().replace(/^#/, '').trim();
        if (num) {
            parts.push(num.match(/^\d+$/) ? `#${num}` : num);
        }
    }

    // Player name
    if (opts.player) parts.push(opts.player.trim());

    // Features (e.g., "Rookie", "Autograph")
    if (opts.features && Array.isArray(opts.features)) {
        for (const f of opts.features) {
            const feat = f.trim();
            // Avoid duplicating info already in the title
            if (feat && !parts.some(p => p.toLowerCase().includes(feat.toLowerCase()))) {
                parts.push(feat);
            }
        }
    }

    // Parallel (e.g., "Refractor", "Silver Prizm")
    if (opts.parallel) {
        const par = opts.parallel.trim();
        if (par && !parts.some(p => p.toLowerCase().includes(par.toLowerCase()))) {
            parts.push(par);
        }
    }

    // Serial numbering (e.g., "/299")
    if (opts.serialNumber) {
        const sn = opts.serialNumber.trim();
        if (sn && !parts.some(p => p.includes(sn))) {
            parts.push(sn);
        }
    }

    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || 'Unknown Card';
};
