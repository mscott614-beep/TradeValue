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
  year: z.string().describe('The year the trading card was produced.'),
  brand: z.string().describe('The brand of the trading card (e.g., Topps, Upper Deck).'),
  set: z.string().describe('The specific set or subset name (e.g., Ultimate Collection, Young Guns, Prizm).').default("Base"),
  player: z.string().describe('The name of the player featured on the card.'),
  cardNumber: z.string().describe('The card number (if any).'),
  estimatedGrade: z.string().describe('The estimated condition/grade of the card (e.g., Mint, Near Mint).'),
  grader: z.string().describe('The specific grading company (e.g., PSA, BGS, SGC, GMA) if the card is in a slab. Return "None" if it is raw/ungraded.').default("None"),
  estimatedMarketValue: z.number().describe('The estimated current market value of the card in USD, based on identity and condition.'),
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
- year: The year the trading card was produced.
- brand: The brand of the trading card (e.g., Topps, Upper Deck).
- set: The specific set or subset name (e.g. "Ultimate Collection", "Young Guns", "Prizm Base", "Chrome"). Look for this text on the card.
- player: The name of the player featured on the card.
- cardNumber: The card number (if any, e.g. "102", "DTATT"). Be very precise.
- estimatedGrade: The estimated condition/grade of the card (e.g., Mint, Near Mint, 9, 10).
- grader: Is the card encased in a professional grading slab? If yes, output the company acronym (e.g. "PSA", "BGS", "SGC", "CGC", "GMA"). If it is raw/ungraded, output exactly "None".
- estimatedMarketValue: Calculate the current market value by taking the average of the last 5 actual **eBay sold listings** for this exact card. If the card is graded, use recent sales of that specific grade. If raw, use raw sales. Provide ONLY the calculated average number in USD.

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
