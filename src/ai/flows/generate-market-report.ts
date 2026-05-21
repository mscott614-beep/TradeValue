import { z } from 'zod';
import { ai, generateWithFallback, PRIMARY_MODEL } from '../genkit';
import { buildInstitutionalReportPrompt } from '@/lib/institutional-report-prompt';

export const generateMarketReportSchema = z.object({
    topic: z.string().optional().describe("Optional specific topic to focus the report on."),
    trendingData: z.array(z.object({
        player: z.string(),
        title: z.string(),
        value: z.string(),
        change: z.string(),
        trend: z.enum(["up", "down"]),
    })).optional().describe("Current trending cards to include in the market snapshot table."),
});

export const generateMarketReport = ai.defineFlow(
    {
        name: 'generateMarketReport',
        inputSchema: generateMarketReportSchema,
        outputSchema: z.string(),
    },
    async (input) => {
        const prompt = buildInstitutionalReportPrompt({
            topic: input.topic,
            trendingData: input.trendingData,
        });

        const response = await generateWithFallback({
            model: PRIMARY_MODEL,
            prompt: prompt,
        });

        return response.text;
    }
);
