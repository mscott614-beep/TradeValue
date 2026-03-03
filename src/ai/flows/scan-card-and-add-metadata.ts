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
  player: z.string().describe('The name of the player featured on the card.'),
  cardNumber: z.string().describe('The card number (if any).'),
  estimatedGrade: z.string().describe('The estimated grade of the card (e.g., Mint, Near Mint).'),
  estimatedMarketValue: z.number().describe('The estimated current market value of the card in USD, based on identity and grade.'),
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

You will identify the card from the provided image(s) and return the year, brand, player, card number, and estimated grade. Use both the front and back of the card if provided for the most accurate identification.

Return a JSON object that contains the following keys:
- year: The year the trading card was produced.
- brand: The brand of the trading card (e.g., Topps, Upper Deck).
- player: The name of the player featured on the card.
- cardNumber: The card number (if any).
- estimatedGrade: The estimated grade of the card (e.g., Mint, Near Mint).
- estimatedMarketValue: Calculate the current market value by taking the average of the last 5 actual **eBay sold listings** for this exact card in **RAW (ungraded)** state matching the estimated condition. Be aware that many base cards from the 1980s and 1990s sell for $10 or less raw. Provide ONLY the calculated average number in USD.

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
    return output!;
  }
);
