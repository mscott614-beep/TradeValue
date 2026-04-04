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
    'numbered', 'variation', 'short print', 'sp', 'ssp',
    'jersey', 'swatch', 'relic', 'memorabilia', 'memo', 'piece', 'material'
];

/**
 * GRADER_KEYWORDS: Used to DETECT if a card is graded.
 * These are grading company names. If any appear in condition/title with a number, card is graded.
 */
const GRADER_KEYWORDS = [
    'psa', 'bgs', 'sgc', 'cgc', 'bccg', 'gma', 'hga', 'csa', 'isa', 'ace', 'fcg', 'ksa', 'mnt', 'csg', 'ags'
];

/**
 * NON_GRADED_EXCLUSIONS: Injected into ungraded card queries to filter out slabs.
 * Must include ALL graders, not just the major 4.
 */
const NON_GRADED_EXCLUSIONS = '-psa -bgs -sgc -cgc -bccg -gma -hga -ksa -mnt -csg -ags -graded -slab';

/** Legacy alias for compatibility */
const BASE_LIKE_KEYWORDS = [
    ...GRADER_KEYWORDS,
    'graded', 'gem mt', 'mint', 'young guns', 'canvas', 'retro', 'rookie class', 'rookie card', 'rc', 'rookie', 'slab', 'auth'
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
    'ice': 'UD Ice',
    'artifacts': 'Artifacts'
};

/**
 * Generic placeholder set names that bloat the eBay query without helping match.
 * "Base Set", "Base", "Hockey", "NHL" are not real subset names.
 */
const GENERIC_SET_STOPWORDS = [
    'base set', 'base', 'hockey', 'nhl', 'nfl', 'nba', 'mlb', 'mls', 'standard',
    'regular', 'common', 'standard issue', 'insert'
];

/**
 * Title-Based Fallback Parser
 * For legacy cards that only have a 'title' field and no structured data.
 * Extracts year, brand, subset, parallel, player, and card number from the full title string.
 */
function parseTitleIntoFields(title: string): Partial<CardDescriptor> {
    if (!title) return {};
    const result: Partial<CardDescriptor> = {};

    // Extract year / season (e.g. "1998-99" or "2001-02")
    const yearMatch = title.match(/\b(\d{4}-\d{2}|\d{4})\b/);
    if (yearMatch) result.year = yearMatch[1];

    // Extract card number (e.g. "#102", "#M-14", "/300", "DTATT")
    // Improved: Capture 3-8 character alphanumeric codes that often appear at the end of titles
    const numMatch = title.match(/#([A-Z0-9\-]+)/i) || 
                     title.match(/\/(\d+)/) ||
                     title.match(/\b([A-Z]{1,3}\d{1,4}|[A-Z]{2,5})\b$/i); 
    if (numMatch) result.cardNumber = numMatch[1];

    // Extract grading from title (e.g. "BCCG 10", "PSA 9", "BGS 9.5")
    // Must find grader name followed by a numeric grade
    const lcTitle = title.toLowerCase();
    for (const grader of GRADER_KEYWORDS) {
        const gradeMatch = lcTitle.match(new RegExp(`\\b${grader}\\s+(\\d+(?:\\.\\d+)?)\\b`));
        if (gradeMatch) {
            result.condition = `${grader.toUpperCase()} ${gradeMatch[1]}`;
            break;
        }
    }

    // Extract brand/series  
    // Order matters: check longer phrases first
    const brandMap: [string, string][] = [
        ['be a player', 'Be A Player'],
        ['between the pipes', 'Between the Pipes'],
        ['in the game', 'In The Game'],
        ['upper deck', 'Upper Deck'],
        ['o-pee-chee', "O-Pee-Chee"],
        ['sp authentic', 'SP Authentic'],
        ['topps chrome', 'Topps Chrome'],
        ['panini prizm', 'Panini Prizm'],
        ['donruss', 'Donruss'],
        ['fleer', 'Fleer'],
        ['parkhurst', 'Parkhurst'],
        ['score', 'Score'],
        ['pro set', 'Pro Set'],
    ];
    const lc = title.toLowerCase();
    for (const [key, val] of brandMap) {
        if (lc.includes(key)) {
            result.brand = val;
            break;
        }
    }

    // Extract known subsets (multi-word)
    const subsetMap: [string, string][] = [
        ['the mask ii', 'The Mask II'],
        ['the mask iii', 'The Mask III'],
        ['the mask', 'The Mask'],
        ['star rookies', 'Star Rookies'],
        ['young guns', 'Young Guns'],
        ['gold auto', 'Gold Auto'],
        ['silver auto', 'Silver Auto'],
        ['die cut', 'Die Cut'],
        ['rookie debut', 'Rookie Debut'],
        ['canvas', 'Canvas'],
        ['retro', 'Retro'],
        ['rookie class', 'Rookie Class'],
    ];
    for (const [key, val] of subsetMap) {
        if (lc.includes(key)) {
            result.set = val;
            break;
        }
    }

    // Extract parallel color
    const parallelColors = ['gold', 'silver', 'blue', 'red', 'green', 'emerald', 'ruby', 'sapphire', 'black', 'purple', 'orange', 'bronze'];
    for (const color of parallelColors) {
        if (lc.includes(color)) {
            result.parallel = color.charAt(0).toUpperCase() + color.slice(1);
            break;
        }
    }

    return result;
}

/**
 * Step 1: Classification Logic
 * Step 2: Search String Construction
 * 
 * Important: If the card lacks structured fields (brand/set/player), 
 * we fall back to parsing them from the title.
 */
export function buildEbayQuery(card: CardDescriptor): { type: 'Base' | 'Parallel', query: string } {
    // === Title-Based Field Enrichment ===
    // If key fields are missing, parse them from the title
    const hasStructuredData = card.brand || card.player || card.set;
    const titleParsed = !hasStructuredData ? parseTitleIntoFields(card.title || '') : {};
    
    // Merge: explicit card fields take priority over parsed title fields
    const effectiveCard: CardDescriptor = {
        ...titleParsed,
        ...Object.fromEntries(Object.entries(card).filter(([, v]) => v != null && v !== '')),
    };

    const parallelText = (effectiveCard.parallel || '').toLowerCase();
    const conditionText = (effectiveCard.condition || '').toLowerCase();
    const titleText = (effectiveCard.title || '').toLowerCase();
    const combinedText = `${parallelText} ${conditionText} ${titleText}`;

    // Also strip generic prefixes like 'BM' or 'RC' which are often inconsistent in listings
    const rawNumber = (effectiveCard.cardNumber || '').replace('#', '').replace(/\b(?:BM|RC)\s*/gi, '');

    // Check if this is a "True Parallel" (a variant that changes the card type)
    // Also include serial numbers (e.g. /299) as parallels
    let serialMatch = (effectiveCard.title || '').match(/\/(?!\/)\s*(\d+)\b/);
    const hasTrueParallel = TRUE_PARALLEL_KEYWORDS.some(k => combinedText.includes(k.toLowerCase())) ||
        !!serialMatch ||
        (parallelText && parallelText !== 'base' && !BASE_LIKE_KEYWORDS.some(g => parallelText.includes(g))) ||
        (rawNumber && !rawNumber.match(/^\d+$/)); // Treat alphanumeric codes as indicators of a non-base card

    // Fix: Preserve and normalize full season years (e.g. 1998-99)
    // If year is just "2017", expand to "2017-18" for modern cards (standard eBay listing style)
    let year = effectiveCard.year || '';
    if (year.match(/^\d{4}$/)) {
        const ySimple = parseInt(year);
        if (ySimple > 1990) {
            const nextYearShort = (ySimple + 1).toString().slice(-2);
            year = `${year}-${nextYearShort}`;
        }
    } else if (year.match(/^\d{4}\s\d{2}$/)) {
        year = year.replace(' ', '-');
    }
    const numericYear = parseInt(year.split('-')[0]);
    
    // Apply Hobby Abbreviations with age-based logic
    let brand = effectiveCard.brand || '';
    if (brand.toLowerCase().includes('be a player')) {
        // For 90s BAP, full name is often better. For 2000s, BAP is the standard.
        brand = numericYear < 2000 ? '"Be A Player"' : 'BAP';
    } else if (brand.toLowerCase().includes('in the game') || brand.toLowerCase().includes('itg')) {
        brand = 'ITG';
    } else {
        Object.entries(HOBBY_ABBREVIATIONS).forEach(([key, val]) => {
            if (brand.toLowerCase().includes(key)) brand = val;
        });
    }

    let setRaw = effectiveCard.set || '';

    // === Brand / Set Merge Logic ===
    // Some cards store the sub-brand (product line) as the 'set' field (e.g. brand="In The Game", set="Be A Player")
    // When we detect a brand-level name in 'set', it should REPLACE the brand in the query, not stack alongside it.
    // This prevents the notorious "ITG BAP" double-brand issue.
    const BRAND_LEVEL_SET_NAMES = [
        { match: 'be a player', brand90s: '"Be A Player"', brand00s: 'BAP' },
        { match: 'between the pipes', brand90s: 'BTP', brand00s: 'BTP' },
        { match: 'o-pee-chee premier', brand90s: 'OPC Premier', brand00s: 'OPC Premier' },
        { match: 'o-pee-chee', brand90s: 'OPC', brand00s: 'OPC' },
    ];
    for (const entry of BRAND_LEVEL_SET_NAMES) {
        if (setRaw.toLowerCase().includes(entry.match) || 
           (brand.toLowerCase().includes('o-pee-chee') && setRaw.toLowerCase() === 'premier' && entry.match === 'o-pee-chee premier')) {
            // The set IS the real brand — replace the brand with the correct era name
            brand = numericYear < 2000 ? entry.brand90s : entry.brand00s;
            setRaw = ''; // Clear the set — it was really the brand
            break;
        }
    }

    // Filter out generic/placeholder set names — they add noise, not signal
    if (setRaw && GENERIC_SET_STOPWORDS.some(stop => setRaw.toLowerCase().trim() === stop)) {
        setRaw = '';
    }
    // Filter out sets that are just the brand name repeated (e.g. "1990-91 Upper Deck Hockey", "2007-08 O-Pee-Chee")
    // A real subset should NOT contain the card's year or the brand name
    if (setRaw && year && setRaw.includes(year.split('-')[0])) {
        setRaw = '';
    }
    if (setRaw && brand && setRaw.toLowerCase().includes(brand.toLowerCase().replace(/"/g, ''))) {
        setRaw = '';
    }
    // Apply abbreviations to set name too
    Object.entries(HOBBY_ABBREVIATIONS).forEach(([key, val]) => {
        if (setRaw.toLowerCase().includes(key)) setRaw = val;
    });

    // Relaxed Set Matching: Do not use explicit quotes around multi-word sets.
    // Sellers routinely abbreviate (e.g. "Ultimate Collection" -> "Ultimate").
    const set = setRaw;

    
    const player = effectiveCard.player || '';

    
    // Lead Architect Update: Alphanumeric codes (e.g. DTA-TT, TS-NK) are often omitted in eBay titles.
    // If numeric, we use # for precision. If alphanumeric, we include it as a raw term to avoid 
    // eBay search parsing errors with parentheses.
    let cardNumber = '';
    // Priority 1: Explicit structured data from 'card' object
    const rawCardNumber = (card.cardNumber || effectiveCard.cardNumber || '').toString();
    const cleanNumber = rawCardNumber.replace('#', '').trim();
    
    if (cleanNumber) {
        if (cleanNumber.match(/^\d+$/)) {
            cardNumber = `#${cleanNumber}`;
        } else {
            // Alphanumeric subset code/identifier (e.g. DTATT, TS-NK): Use as a plain term
            cardNumber = cleanNumber; 
        }
    }
    const parallelRaw = effectiveCard.parallel && effectiveCard.parallel.toLowerCase() !== 'base' ? effectiveCard.parallel : '';
    // Map 'Autographed' and 'Autograph' to 'Auto' (hobby standard for eBay)
    const parallel = parallelRaw.replace(/autograph(?:ed)?\s*/gi, 'Auto ').trim();

    // Grading Logic: Always check BOTH condition field AND title.
    // This handles legacy cards where grading info is embedded in the title but not in a separate condition field.
    const conditionHasGrade = GRADER_KEYWORDS.some(k => conditionText.includes(k)) && /\d+/.test(conditionText);
    const titleHasGrade = GRADER_KEYWORDS.some(k => titleText.includes(k)) && /\d+/.test(titleText);
    const isGraded = conditionHasGrade || titleHasGrade;
    
    // Build the grade string for insertion into the query (e.g. "BCCG 10", "PSA 9")
    let gradeString = '';
    if (isGraded) {
        if (effectiveCard.condition && conditionHasGrade) {
            // Prefer explicit condition field if it has grading info
            gradeString = effectiveCard.condition;
        } else {
            // Fall back to extracting from title — covers legacy cards scanned as a full title string
            for (const grader of GRADER_KEYWORDS) {
                const gradeMatch = titleText.match(new RegExp(`\\b${grader}\\s+(\\d+(?:\\.\\d+)?)\\b`));
                if (gradeMatch) {
                    gradeString = `${grader.toUpperCase()} ${gradeMatch[1]}`;
                    break;
                }
            }
        }
    }

    // Parallel-specific exclusions (e.g. if searching 'Gold', exclude 'Silver')
    const PARALLEL_EXCLUSIONS: Record<string, string> = {
        'gold': '-silver -bronze -base',
        'silver': '-gold -bronze -base',
        'blue': '-red -green -gold -silver',
        'emerald': '-ruby -sapphire -gold -silver',
        'ruby': '-emerald -sapphire -gold -silver',
        'sapphire': '-emerald -ruby -gold -silver'
    };
    let autoExclusions = '';
    Object.entries(PARALLEL_EXCLUSIONS).forEach(([key, val]) => {
        if (parallel.toLowerCase().includes(key) || setRaw.toLowerCase().includes(key)) {
            autoExclusions = val;
        }
    });

    // Extract serial number from title (e.g. "/299", "/25") for numbered cards
    // This is included in parallel queries since numbered cards are parallels by definition
    serialMatch = (effectiveCard.title || '').match(/\/(?!\/)\s*(\d+)\b/);
    const serialNumber = serialMatch ? `/${serialMatch[1]}` : '';

    if (!hasTrueParallel) {
        // Base Card Query: Mandatory Negative Keywords to exclude high-value parallels
        const negativeKeywords = '-parallel -refractor -silver -prizm -auto -jersey -patch -reprint -digital';
        // For ungraded cards: block ALL graders (psa, bgs, sgc, cgc, bccg, gma, hga, etc.)
        // For graded cards: include the grader+grade instead
        const gradingExclusions = !isGraded ? NON_GRADED_EXCLUSIONS : '';
        let query = `${gradeString} ${year} ${brand} ${set} ${player} ${cardNumber} ${negativeKeywords} ${gradingExclusions} ${autoExclusions}`.replace(/\s+/g, ' ').trim();
        return { type: 'Base', query };
    } else {
        // Parallel Query: Feature name is a mandatory inclusion
        // For numbered cards with no color name, use the serial number as the differentiator
        // Do NOT use 'insert' as a fallback — it's too generic and rarely in eBay titles
        const feature = parallel;
        const serialPart = serialNumber;
        let query = `${gradeString} ${year} ${brand} ${set} ${player} ${feature} ${cardNumber} ${serialPart} ${autoExclusions} -reprint -digital`.replace(/\s+/g, ' ').trim();
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
