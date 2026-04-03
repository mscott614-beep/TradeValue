import { ai } from '@/ai/genkit';
import { z } from 'zod';

const ExtractEbayOutputSchema = z.object({
    title: z.string().describe("The full name or title of the card, e.g., '2023 Panini Prizm Victor Wembanyama Rookie'"),
    player: z.string().describe("The main player or subject featured on the card."),
    year: z.coerce.number().describe("The year the card was produced (e.g., 2023)."),
    brand: z.string().describe("The manufacturer name (e.g., 'Panini', 'Topps', 'Upper Deck'). Do NOT include the year."),
    set: z.string().optional().describe("The specific set or series (e.g., 'Prizm', 'Chrome', 'Series 2', 'O-Pee-Chee Platinum'). Do NOT include the year."),
    cardNumber: z.string().optional().describe("The card number usually found on the back, e.g., '201', '101', 'C-1'."),
    condition: z.string().describe("The overall condition. Use 'Raw' if ungraded, or the full grade like 'PSA 10', 'BGS 9.5'."),
    grader: z.string().describe('The specific grading company acronym (e.g., PSA, BGS, SGC, CGC, GMA). Return "None" if it is raw/ungraded.').default("None"),
    estimatedGrade: z.string().optional().describe("The numeric grade value (e.g., '10', '9.5', '8'). Only for graded cards."),
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
    1. Extract the player, year, brand, and set.
    2. **CRITICAL**: The 'brand' field should be the manufacturer (e.g. Upper Deck). The 'set' field should be the series (e.g. O-Pee-Chee Platinum). 
    3. **CRITICAL**: Do NOT include the year in the 'brand' or 'set' fields. The year goes in the 'year' field only. 
    4. Extract the card number (e.g. #201) if available on the listing or description.
    5. Determine the condition. If it mentions PSA, BGS, or SGC with a grade, use that (e.g., PSA 10). Otherwise, default to 'Raw'.
    6. Identify the grader if applicable (e.g., PSA, BGS, SGC, CGC, GMA). If it is a raw/ungraded card, output exactly "None".
    7. Identify the numeric grade (e.g. 10, 9.5) and put it in 'estimatedGrade'.
    8. Identify if there is a specific parallel/refractor (e.g., 'Silver', 'Holo', 'Atomic Refractor'). If none is explicitly stated, leave it blank.
    9. List any special features (e.g., 'Rookie', 'Autograph', 'Patch', 'Serial Numbered', '1st Edition').
    10. Find the asking price or current bid price in the text and parse it into a raw number for the 'currentMarketValue' field.
    `;

    const response = await ai.generate({
        prompt: prompt,
        model: 'googleai/gemini-3.1-flash-lite-preview',
        output: { schema: ExtractEbayOutputSchema }
    });

    if (!response.output) {
        throw new Error("Failed to extract card details from the provided text.");
    }

    return response.output;
});

