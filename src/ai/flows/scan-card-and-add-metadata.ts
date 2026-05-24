'use server';
/**
 * @fileOverview An AI agent that identifies trading cards from images and saves their metadata to a user's portfolio.
 *
 * - scanCardAndAddMetadata - A function that handles the card scanning and metadata saving process.
 * - ScanCardAndAddMetadataInput - The input type for the scanCardAndAddMetadata function.
 * - ScanCardAndAddMetadataOutput - The return type for the scanCardAndAddMetadata function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { ebayService } from '@/lib/ebay';

const ScanCardAndAddMetadataInputSchema = z.object({
  frontPhotoDataUri: z
    .string()
    .describe(
      "A photo of the front of a trading card, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  backPhotoDataUri: z
    .string()
    .optional()
    .describe(
      "An optional photo of the back of a trading card, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ScanCardAndAddMetadataInput = z.infer<typeof ScanCardAndAddMetadataInputSchema>;

const ScanCardAndAddMetadataOutputSchema = z.object({
  year: z.string().describe('The full production year or season of the card. For multi-year seasons use the full format like "2013-14" or "2023-24". For single-year products just use "2023".'),
  brand: z.string().describe('The manufacturer name ONLY (e.g., Topps, Upper Deck, Panini). Do NOT include the year or subset.'),
  set: z.string().describe('The specific subset or series name ONLY — NOT the brand. Examples: "Young Guns", "Ultimate Collection", "Prizm", "Chrome". If no specific subset, return "Base". Do NOT repeat the brand name.').default("Base"),
  player: z.string().describe('The name of the player featured on the card.'),
  parallel: z.string().optional().describe('The specific parallel or refractor name (e.g. "Silver", "Red Wave", "Refractor"). Leave blank if base.').default(""),
  cardNumber: z.string().describe('The card identifier from the BACK of the card (usually in the top corners, e.g., "6", "DTA-TT", "202"). DO NOT infer the card number by looking at the jersey in the photograph. Do NOT use the serial number.'),
  serialNumber: z.string().optional().describe('The print run/serial number if present (e.g., "/149", "25/99"). Leave blank if not numbered.').default(""),
  estimatedGrade: z.string().describe('The estimated condition/grade of the card (e.g., Mint, Near Mint).'),
  grader: z.string().describe('The specific grading company (e.g., PSA, BGS, SGC, GMA) if the card is in a slab. Return "None" if it is raw/ungraded.').default("None"),
  estimatedMarketValue: z.number().describe('The estimated current market value of the card in USD, based on identity and condition.'),
  conditionAssessment: z.object({
    centeringRatio: z.string().describe('e.g., "55/45 left-to-right, 50/50 top-to-bottom"'),
    edgeWearAlerts: z.array(z.string()).describe('List of noted issues, e.g., ["surface silvering", "minor corner softening top-left"]'),
    estimatedGradeTarget: z.string().describe('e.g., "PSA 8 - PSA 9 Near-Mint/Mint"'),
    conditionConfidenceScore: z.number().min(0).max(100).describe('0-100 score indicating visual clarity confidence')
  }).describe('Visual assessment of the physical condition of the card.'),
});

export type ScanCardAndAddMetadataOutput = z.infer<typeof ScanCardAndAddMetadataOutputSchema>;

export async function scanCardAndAddMetadata(input: ScanCardAndAddMetadataInput): Promise<ScanCardAndAddMetadataOutput> {
  return scanCardAndAddMetadataFlow(input);
}

const scanCardPrompt = ai.definePrompt({
  name: 'scanCardPrompt',
  input: { schema: ScanCardAndAddMetadataInputSchema },
  output: { schema: ScanCardAndAddMetadataOutputSchema },
  prompt: `You are an expert trading card authenticator and grader.

You will identify the card from the provided image(s) and return the year, brand, set, player, card number, condition, grader, and estimated value.

Return a JSON object that contains the following keys:
- year: The full production year or season. For multi-year seasons (common in hockey and basketball), use the full format like '2013-14' or '2023-24'. For single-year products, use just the year like '2023'.
- brand: The brand of the trading card (e.g., Topps, Upper Deck).
- set: The specific set or subset name (e.g. "Ultimate Collection", "Young Guns", "Prizm Base", "Chrome"). Look for this text on the card.
- player: The name of the player featured on the card.
- cardNumber: The card number (if any, e.g. "6", "102", "DTATT"). Be very precise. DO NOT identify or infer the card number by looking at the player's jersey in the photograph. Note: Card numbers are generally (but not always) found on the top corners of the back of the card. If you cannot see the printed card number, just output "Unknown" or infer from set logic.
- estimatedGrade: The estimated condition/grade of the card (e.g., Mint, Near Mint, 9, 10).
- grader: Is the card encased in a professional grading slab? If yes, output the company acronym (e.g. "PSA", "BGS", "SGC", "CGC", "GMA"). If it is raw/ungraded, output exactly "None".
- estimatedMarketValue: Calculate the current market value by taking the average of the last 5 actual **eBay sold listings** for this exact card. If the card is graded, use recent sales of that specific grade. If raw, use raw sales. Provide ONLY the calculated average number in USD.
- conditionAssessment: A deep visual diagnostic. 
  1. Examine the symmetry of the outer card margins relative to the inner artwork borders. Calculate the horizontal and vertical centering ratios.
  2. Inspect the contrast points along the four corners and perimeter edges. Look for white chipping spots, fraying fibers, surface scratches, or print lines.
  3. Output a realistic, highly defensive condition grading target based on standard hobby registries (like PSA/BGS). Avoid grading hallucinations by relying strictly on clear, visible structural elements.

Analyze the following card image(s):
Card Front:
{{media url=frontPhotoDataUri}}

{{#if backPhotoDataUri}}
Card Back:
{{media url=backPhotoDataUri}}
{{/if}}
`,
});

const scanCardAndAddMetadataFlow = ai.defineFlow(
  {
    name: 'scanCardAndAddMetadataFlow',
    inputSchema: ScanCardAndAddMetadataInputSchema,
    outputSchema: ScanCardAndAddMetadataOutputSchema,
  },
  async input => {
    const { output } = await scanCardPrompt(input);
    
    if (output) {
      try {
        // Build a precise query for eBay including condition
        let conditionStr = "";
        if (output.grader !== "None") {
          conditionStr = `${output.grader} ${output.estimatedGrade}`;
        } else {
          // EXCLUSION: For raw cards, explicitly exclude graded terms to prevent price inflation
          conditionStr = "Raw -PSA -BGS -SGC -CGC -GMA -Graded -Slab -Auth";
        }
        
        const query = `${output.year} ${output.brand} ${output.player} ${output.cardNumber} ${conditionStr}`.trim();
        console.log(`Searching eBay for: "${query}"`);
        
        const ebayResults = await ebayService.searchActiveAuctions(query, 10);
        
        if (ebayResults.itemSummaries && ebayResults.itemSummaries.length > 0) {
          // Use MEDIAN price for better stability (ignores high overpriced outliers)
          const prices = ebayResults.itemSummaries
            .map(item => parseFloat(item.price.value))
            .filter(p => !isNaN(p))
            .sort((a, b) => a - b);

          if (prices.length > 0) {
            const mid = Math.floor(prices.length / 2);
            const medianPrice = prices.length % 2 !== 0 
              ? prices[mid] 
              : (prices[mid - 1] + prices[mid]) / 2;
              
            output.estimatedMarketValue = parseFloat(medianPrice.toFixed(2));
          }
        }
      } catch (error) {
        console.error('eBay Preis-Abfrage während Scan fehlgeschlagen:', error);
        // Fallback to the AI's estimation if the API fails
      }
    }
    
    return output!;
  }
);
