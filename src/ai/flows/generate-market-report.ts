import { genkit } from 'genkit';
import { z } from 'zod';
import { ai } from '../genkit';

export const generateMarketReportSchema = z.object({
    topic: z.string().optional().describe("Optional specific topic to focus the report on (e.g., 'Hockey Cards', 'Connor McDavid', '1990s Junk Wax'). If omitted, a general market report will be generated."),
});

export const generateMarketReport = ai.defineFlow(
    {
        name: 'generateMarketReport',
        inputSchema: generateMarketReportSchema,
        outputSchema: z.string(),
    },
    async (input) => {
        const focusContext = input.topic
            ? `Focus this report specifically on the market for: ${input.topic}.`
            : `Provide a broad, general overview of the current high-end sports card trading market.`;

        const prompt = `
      You are an expert sports card market analyst, writing a weekly "Market Intelligence Report" for high-end collectors and investors.

      ${focusContext}

      Please write a concise, professional, and well-structured report using Markdown formatting.
      The report should include:
      1. A catchy Title.
      2. **Market Sentiment**: A 2-3 sentence overview of the current buying/selling climate.
      3. **Hot Prospects & Trending Players**: 2-3 players whose card values are rising rapidly, with a brief explanation of why.
      4. **Cold Streaks**: 1-2 players or segments that are currently cooling off or overvalued.
      5. **Investment Spotlight**: One specific card or set recommendation that you believe is currently undervalued or poised for growth.

      Do not use conversational filler (like "Here is the report"). Just output the raw Markdown report directly.
    `;

        const response = await ai.generate({
            model: 'googleai/gemini-3.1-flash-lite-preview',
            prompt: prompt,
        });

        return response.text;
    }
);
