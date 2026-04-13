import { ai, generateWithFallback, PRIMARY_MODEL } from '@/ai/genkit';
import { z } from 'zod';

const ParsedCsvRowSchema = z.object({
    title: z.string().describe("The cleaned, original title without noise keywords like L@@K, MUST SEE, INVEST, emojis, etc."),
    player: z.string().describe("The main player or subject featured on the card. Standardize capitalization."),
    year: z.string().describe("The year the card was produced (e.g., '2023'). Leave empty if not found."),
    brand: z.string().describe("The manufacturer and set (e.g., 'Panini Prizm', 'Topps Chrome'). Standardize capitalization."),
    condition: z.string().describe("The grading condition. Use 'Raw' if ungraded, or the specific grade like 'PSA 10', 'BGS 9.5', etc."),
    grader: z.string().describe('The specific grading company acronym (e.g., PSA, BGS, SGC) if graded. Respond with "None" if raw/ungraded.').default("None"),
    parallel: z.string().describe("The specific parallel or refractor (e.g., 'Silver', 'Holo', 'Atomic Refractor'). Leave empty if none."),
    features: z.array(z.string()).describe("A list of special features (e.g., 'Rookie', 'Autograph', 'Patch', 'Serial Numbered'). Empty array if none."),
});

const ParseCsvTitlesOutputSchema = z.object({
    results: z.array(ParsedCsvRowSchema).describe("An array of parsed results perfectly matching the order and length of the input titles array.")
});

export const parseCsvTitlesFlow = ai.defineFlow({
    name: 'parseCsvTitles',
    inputSchema: z.array(z.string()),
    outputSchema: ParseCsvTitlesOutputSchema,
}, async (titles: string[]) => {

    const prompt = `
    Objective: Parse the provided array of trading card eBay listing titles.
    
    For each title, analyze it to extract the following fields strictly following these rules:
    - Player
    - Year
    - Brand/Set
    - Condition (e.g., 'PSA 10', 'BGS 9', 'Raw')
    - Grader (e.g., 'PSA', 'BGS', 'None')
    - Parallel/Refractor
    - Special Features
    
    CRITICAL CLEANING RULES:
    1. Clean the extracted data by removing noise keywords such as L@@K, MUST SEE, INVEST, 🔥, 📈, and any other emojis.
    2. Standardize the capitalization of names and brands (e.g., "PANINI PRIZM" -> "Panini Prizm", "VICTOR WEMBANYAMA" -> "Victor Wembanyama").
    3. If data for any field is missing, leave the string empty (do not write "N/A" or "Unknown").
    4. You MUST return exactly ${titles.length} results in the array, in the exact same order as they were provided.

    Here are the listing titles to parse:
    ${JSON.stringify(titles, null, 2)}
    `;

    const response = await generateWithFallback({
        prompt: prompt,
        model: PRIMARY_MODEL,
        output: { schema: ParseCsvTitlesOutputSchema }
    });

    if (!response.output || !response.output.results) {
        throw new Error("Failed to extract card details from the provided titles.");
    }

    // Double check that we received the exact number of responses
    if (response.output.results.length !== titles.length) {
        console.warn(`Mismatch in AI response array length. Expected ${titles.length}, got ${response.output.results.length}`);
    }

    return response.output;
});
