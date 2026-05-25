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
import { calculateCardBorders } from '@/lib/image-boundary-scanner';

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
  borderMetricsStr: z.string().optional().describe("System injected border measurements."),
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
  estimatedGrade: z.string().describe("The estimated condition/grade of the card (e.g., Mint, Near Mint). Do NOT return 'RAW'."),
  grader: z.string().describe('The specific grading company (e.g., PSA, BGS, SGC, GMA) if the card is in a slab. Return "None" if it is raw/ungraded. Do NOT return "RAW".').default("None"),
  estimatedMarketValue: z.number().describe('The estimated current market value of the card in USD, based on identity and condition.'),
  conditionAssessment: z.object({
    centeringRatio: z.string().describe('You MUST explain your math. Example: "Left cardboard margin is 10%, Right is 90%. Top is 50%, Bottom is 50%. Final Ratio: 10/90 L/R, 50/50 T/B." Do not just output the ratio, write out the margin measurements first.'),
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
  1. CRITICAL: GEOMETRIC ANCHORING & SEVERE ASYMMETRY PROTOCOL. You are currently misinterpreting severe card asymmetry as a balanced 45/55 split. You must completely reset your spatial coordinate tracking by performing the following strict geometric audit before making any grading judgments. 1. Locate the absolute physical edge of the entire image asset (the outermost pixels of the card canvas). 2. Measure inward from the extreme LEFT outer boundary to the first graphic line of the inner card artwork. Note this pixel distance as [L_Margin]. 3. Measure inward from the extreme RIGHT outer boundary to the last graphic line of the inner card artwork. Note this pixel distance as [R_Margin]. Execute this Explicit Chain-of-Thought Validation: Compare [L_Margin] directly to [R_Margin]. Is one margin visibly microscopic, near-zero, or multi-times smaller than the other? If [L_Margin] is less than 15% of the total combined margins, do NOT output a balanced ratio. You are likely anchoring to an internal graphic line instead of the true physical border. You must explicitly state: "Checking for extreme negative space collapse." If one side has virtually no background margin compared to the opposite side, you must flag this as an extreme 5/95 to 10/90 structural asymmetry. Strict Rule: If there is an obvious visual imbalance where the artwork is jammed against one edge and wide open on the other, any output declaring a 45/55 or 50/50 split is a geometric failure and violates instructions. Adjust your calculated ratio to reflect the raw imbalance. Hard Rule: If centering is 10/90 or worse, the 'estimatedGradeTarget' MUST be capped at a maximum of PSA 5 to PSA 6 (Excellent to Excellent-Mint), or flagged with a mandatory "MC" (Miscut) qualifier in your notes.
  3. Inspect the contrast points along the four corners and perimeter edges. Look for white chipping spots, fraying fibers, surface scratches, or print lines.
  4. Output a realistic, highly defensive condition grading target based on standard hobby registries (like PSA/BGS). Avoid grading hallucinations by relying strictly on clear, visible structural elements.

Analyze the following card image(s):
Card Front:
{{media url=frontPhotoDataUri}}

{{#if backPhotoDataUri}}
Card Back:
{{media url=backPhotoDataUri}}
{{/if}}

{{#if borderMetricsStr}}
{{borderMetricsStr}}
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
    try {
      const base64Data = input.frontPhotoDataUri.replace(/^data:image\/\w+;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");
      const metrics = await calculateCardBorders(imageBuffer);
      input.borderMetricsStr = `\n[SYSTEM INJECTED BORDER METRICS]
The backend image pre-processor has already calculated the physical margins of this card:
- Calculated Left/Right Ratio: ${metrics.leftRightRatio}
- Calculated Top/Bottom Ratio: ${metrics.topBottomRatio}
- Hard Miscut Flag: ${metrics.isMiscut ? 'true' : 'false'}
- Raw Margins (px): L=${metrics.margins.left}, R=${metrics.margins.right}, T=${metrics.margins.top}, B=${metrics.margins.bottom}

If Hard Miscut Flag is true, or if either ratio shows a split worse than 70/30, you must ignore any clean surfaces or sharp corners you think you see. You are forbidden from outputting an optimistic grade. Your final JSON output for BOTH estimatedGrade AND estimatedGradeTarget MUST be capped at a maximum value of PSA 6 or lower. Even if raw, output a numeric grade estimate (e.g. 'PSA 5' or 'Excellent'). Do not output null for estimatedGrade.
You MUST use these exact ratios for your condition assessment. Do not override them with your visual estimation.\n`;
    } catch (err) {
      console.warn("[Scanner] Failed to calculate card borders in Genkit flow:", err);
    }

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
