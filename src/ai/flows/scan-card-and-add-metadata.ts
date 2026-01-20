'use server';
/**
 * @fileOverview An AI agent that identifies hockey cards from images and saves their metadata to a user's portfolio.
 *
 * - scanCardAndAddMetadata - A function that handles the card scanning and metadata saving process.
 * - ScanCardAndAddMetadataInput - The input type for the scanCardAndAddMetadata function.
 * - ScanCardAndAddMetadataOutput - The return type for the scanCardAndAddMetadata function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ScanCardAndAddMetadataInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of a hockey card, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ScanCardAndAddMetadataInput = z.infer<typeof ScanCardAndAddMetadataInputSchema>;

const ScanCardAndAddMetadataOutputSchema = z.object({
  year: z.string().describe('The year the hockey card was produced.'),
  brand: z.string().describe('The brand of the hockey card (e.g., Topps, Upper Deck).'),
  player: z.string().describe('The name of the hockey player featured on the card.'),
  cardNumber: z.string().describe('The card number (if any).'),
  estimatedGrade: z.string().describe('The estimated grade of the card (e.g., Mint, Near Mint).'),
});

export type ScanCardAndAddMetadataOutput = z.infer<typeof ScanCardAndAddMetadataOutputSchema>;

export async function scanCardAndAddMetadata(input: ScanCardAndAddMetadataInput): Promise<ScanCardAndAddMetadataOutput> {
  return scanCardAndAddMetadataFlow(input);
}

const scanCardPrompt = ai.definePrompt({
  name: 'scanCardPrompt',
  input: {schema: ScanCardAndAddMetadataInputSchema},
  output: {schema: ScanCardAndAddMetadataOutputSchema},
  prompt: `You are an expert hockey card authenticator and grader.

You will identify the card from the provided image and return the year, brand, player, card number, and estimated grade.

Return a JSON object that contains the following keys:
- year: The year the hockey card was produced.
- brand: The brand of the hockey card (e.g., Topps, Upper Deck).
- player: The name of the hockey player featured on the card.
- cardNumber: The card number (if any).
- estimatedGrade: The estimated grade of the card (e.g., Mint, Near Mint).

Analyze the following card image:
{{media url=photoDataUri}}
`,
});

const scanCardAndAddMetadataFlow = ai.defineFlow(
  {
    name: 'scanCardAndAddMetadataFlow',
    inputSchema: ScanCardAndAddMetadataInputSchema,
    outputSchema: ScanCardAndAddMetadataOutputSchema,
  },
  async input => {
    const {output} = await scanCardPrompt(input);
    return output!;
  }
);
