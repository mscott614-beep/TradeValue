import { ai } from '@/ai/genkit';
import { z } from 'zod';

const ExtractEbayOutputSchema = z.object({
    title: z.string().describe("The full name or title of the card, e.g., '2023 Panini Prizm Victor Wembanyama Rookie'"),
    player: z.string().describe("The main player or subject featured on the card."),
    year: z.coerce.number().describe("The year the card was produced (e.g., 2023)."),
    brand: z.string().describe("The manufacturer and set (e.g., 'Panini Prizm', 'Topps Chrome')."),
    condition: z.string().describe("The grading condition. Use 'Raw' if ungraded, or the specific grade like 'PSA 10', 'BGS 9.5', etc."),
    grader: z.string().describe('The specific grading company acronym (e.g., PSA, BGS, SGC, CGC, GMA) if the item is graded. Return "None" if it is raw/ungraded.').default("None"),
    parallel: z.string().optional().describe("The specific parallel or variety, if any (e.g., 'Silver Prizm', 'Refractor', 'Red Wave'). Leave blank if it's a base card."),
    features: z.array(z.string()).describe("A list of special attributes, like 'Rookie', 'Autograph', 'Serial Numbered', 'Patch'. Empty array if none."),
    currentMarketValue: z.number().describe("The parsed price from the listing, representing the estimated market value or asking price. Return 0 if not found."),
});

export const extractEbayListing = ai.defineFlow({
    name: 'extractEbayListing',
    inputSchema: z.string(),
    outputSchema: ExtractEbayOutputSchema,
}, async (listingText: string) => {

    // We append the list of recognized attributes and parallels to help the model standardize its output.
    const prompt = `
    You are an expert sports card appraiser. I will provide you with the raw text extracted from an eBay listing for a trading card. Your job is to extract the key metadata about the card to populate a digital portfolio.

    Raw Listing Text:
    "${listingText}"
    
    Instructions:
    1. Extract the player, year, and brand/set.
    2. Determine the condition. If it mentions PSA, BGS, or SGC with a grade, use that (e.g., PSA 10). Otherwise, default to 'Raw'.
    3. Identify the grader if applicable (e.g., PSA, BGS, SGC, CGC, GMA). If it is a raw/ungraded card, output exactly "None".
    4. Identify if there is a specific parallel/refractor (e.g., 'Silver', 'Holo', 'Atomic Refractor'). If none is explicitly stated, leave it blank.
    5. List any special features (e.g., 'Rookie', 'Autograph', 'Patch', 'Serial Numbered', '1st Edition').
    6. Find the asking price or current bid price in the text and parse it into a raw number for the 'currentMarketValue' field.
    `;

    const response = await ai.generate({
        prompt: prompt,
        model: 'googleai/gemini-2.5-flash',
        output: { schema: ExtractEbayOutputSchema }
    });

    if (!response.output) {
        throw new Error("Failed to extract card details from the provided text.");
    }

    return response.output;
});
