'use server';
/**
 * @fileOverview Predicts the win probability of an auction item on a user's watchlist.
 *
 * - predictAuctionWinProbability - A function that predicts the win probability of an auction item.
 * - PredictAuctionWinProbabilityInput - The input type for the predictAuctionWinProbability function.
 * - PredictAuctionWinProbabilityOutput - The return type for the predictAuctionWinProbability function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const PredictAuctionWinProbabilityInputSchema = z.object({
  auctionItemDescription: z.string().describe('Description of the auction item, including details like current bid, number of bids, and time remaining.'),
  userBidAmount: z.number().describe('The amount the user is willing to bid.'),
});
export type PredictAuctionWinProbabilityInput = z.infer<typeof PredictAuctionWinProbabilityInputSchema>;

const PredictAuctionWinProbabilityOutputSchema = z.object({
  winProbability: z.number().describe('The predicted probability (0 to 1) of winning the auction with the given bid.'),
  reasoning: z.string().describe('Explanation of why the model predicted the win probability.'),
});
export type PredictAuctionWinProbabilityOutput = z.infer<typeof PredictAuctionWinProbabilityOutputSchema>;

export async function predictAuctionWinProbability(input: PredictAuctionWinProbabilityInput): Promise<PredictAuctionWinProbabilityOutput> {
  return predictAuctionWinProbabilityFlow(input);
}

const prompt = ai.definePrompt({
  name: 'predictAuctionWinProbabilityPrompt',
  input: {schema: PredictAuctionWinProbabilityInputSchema},
  output: {schema: PredictAuctionWinProbabilityOutputSchema},
  prompt: `You are an expert auction analyst. Given the details of an auction item and the user's bid, predict the probability of the user winning the auction.

Auction Item Details: {{{auctionItemDescription}}}
User Bid Amount: {{{userBidAmount}}}

Consider factors such as the current bid, number of bids, time remaining, and any other relevant information to estimate the win probability. Provide a brief explanation of your reasoning.

Format your response as a JSON object with "winProbability" (a number between 0 and 1) and "reasoning" (a string).`,
});

const predictAuctionWinProbabilityFlow = ai.defineFlow(
  {
    name: 'predictAuctionWinProbabilityFlow',
    inputSchema: PredictAuctionWinProbabilityInputSchema,
    outputSchema: PredictAuctionWinProbabilityOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
