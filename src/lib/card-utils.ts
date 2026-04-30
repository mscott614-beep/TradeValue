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
