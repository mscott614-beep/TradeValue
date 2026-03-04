import Papa from 'papaparse';
import type { Portfolio } from '@/lib/types';

export function downloadCSV(cards: Portfolio[]) {
    // Define the columns we want to export, mapping from internal keys to user-friendly headers
    const csvData = cards.map(card => ({
        'Title': card.title,
        'Player': card.player,
        'Year': card.year,
        'Brand/Set': card.brand,
        'Condition': card.condition,
        'Parallel/Refractor': card.parallel || '',
        'Special Features': card.features?.join(', ') || '',
        'Purchase Price': card.purchasePrice || 0,
        'Current Market Value': card.currentMarketValue || 0,
        'Date Added': card.dateAdded ? new Date(card.dateAdded).toISOString().split('T')[0] : '', // Format date locally
        'Card ID': card.id // Useful if they want to re-import updates later
    }));

    // Generate the CSV string using PapaParse
    const csvString = Papa.unparse(csvData);

    // Create a Blob from the CSV string
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });

    // Create a download link and trigger it
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `portfolio_export_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

const headerSynonyms: Record<string, string[]> = {
    title: ["Title", "Item title", "Item Name", "Card Name", "Name", "Listing Title"],
    player: ["Player", "Athlete", "Subject", "Person"],
    year: ["Year", "Season", "Date"],
    brand: ["Brand/Set", "Set", "Brand", "Manufacturer", "Product", "Series"],
    condition: ["Condition", "Grade", "Professional Grade", "Card Condition"],
    purchasePrice: ["Purchase Price", "Price", "Sold For", "Paid", "Cost", "Price Paid"],
    currentMarketValue: ["Current Market Value", "Value", "Market Price", "Est Value", "Estimated Value"],
    cardNumber: ["Card Number", "Card #", "Number", "#"],
    parallel: ["Parallel/Refractor", "Parallel", "Refractor", "Variant"],
    features: ["Special Features", "Features", "Attributes", "Notes"]
};

const POPULAR_BRANDS = [
    "Topps Chrome", "Topps", "Bowman Chrome", "Bowman",
    "Panini Prizm", "Panini Optic", "Panini", "Donruss Optic", "Donruss",
    "Select", "Mosaic", "Upper Deck", "Fleer", "Score", "Leaf",
    "National Treasures", "Flawless", "Immaculate", "Contenders", "Prizm"
];

const PARALLEL_KEYWORDS = [
    "Refractor", "Silver", "Holo", "Prizm", "Mojo", "Auto", "Patch", "RPA",
    "RC", "Rookie", "Numbered", "SP", "SSP", "Parallel", "1st", "First"
];

export function parseCardTitle(title: string): Partial<Portfolio> {
    const extracted: Partial<Portfolio> = {};
    if (!title) return extracted;

    // Extract Year
    const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearMatch) extracted.year = yearMatch[1];

    // Extract Condition/Grade
    const gradeMatch = title.match(/\b(PSA|BGS|SGC|CGC|GMA|CSG)\s*([\d\.]+)\b/i);
    if (gradeMatch) {
        extracted.condition = `${gradeMatch[1].toUpperCase()} ${gradeMatch[2]}`;
        extracted.grader = gradeMatch[1].toUpperCase();
    }

    // Extract Brand
    for (const brand of POPULAR_BRANDS) {
        if (title.toLowerCase().includes(brand.toLowerCase())) {
            extracted.brand = brand;
            break;
        }
    }

    // Attempt to extract Player Name
    // A heuristic: Player name often follows the Year and Brand. 
    // We remove the Year, Brand, Grade, and known keywords, and what's left is likely the player.
    let playerString = title;
    if (extracted.year) playerString = playerString.replace(new RegExp(`\\b${extracted.year}\\b`, 'g'), '');
    if (extracted.brand) playerString = playerString.replace(new RegExp(`\\b${extracted.brand}\\b`, 'ig'), '');
    if (gradeMatch) playerString = playerString.replace(gradeMatch[0], '');

    // Remove `#` and numbers
    playerString = playerString.replace(/#\w+/g, '');

    // Remove parallel keywords
    for (const kw of PARALLEL_KEYWORDS) {
        playerString = playerString.replace(new RegExp(`\\b${kw}\\b`, 'ig'), '');
    }

    // Remove random punctuation and extra spaces
    playerString = playerString.replace(/[-_(){}[\]*!]/g, ' ').replace(/\s{2,}/g, ' ').trim();

    // Grab the first 2-3 words as the player name (most reliable fallback)
    const words = playerString.split(' ').filter(w => w.length > 0);
    if (words.length >= 2) {
        extracted.player = `${words[0]} ${words[1]}`;
    } else if (words.length === 1) {
        extracted.player = words[0];
    }

    return extracted;
}

export function normalizeCsvRow(row: any): Partial<Portfolio> {
    const normalized: any = {};
    const keys = Object.keys(row);

    // console.log("Normalizing row keys:", keys);

    // For each internal field, find the first matching synonym in the row
    Object.entries(headerSynonyms).forEach(([internalKey, synonyms]) => {
        const matchingKey = keys.find(k => {
            // Remove BOM and other non-visible characters, trim, and lowercase
            const cleanKey = k.replace(/[^\x20-\x7E]/g, '').trim().toLowerCase();
            return synonyms.some(s => s.toLowerCase() === cleanKey);
        });

        if (matchingKey) {
            normalized[internalKey] = row[matchingKey];
        }
    });

    // Smart parsing fallback from title if key fields are missing
    if (normalized.title) {
        const parsed = parseCardTitle(normalized.title);
        if (!normalized.player && parsed.player) normalized.player = parsed.player;
        if (!normalized.year && parsed.year) normalized.year = parsed.year;
        if (!normalized.brand && parsed.brand) normalized.brand = parsed.brand;
        if (!normalized.condition && parsed.condition) normalized.condition = parsed.condition;
        if (!normalized.grader && parsed.grader) normalized.grader = parsed.grader;
    }

    return normalized;
}
