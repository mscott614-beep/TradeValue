import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { z } from 'zod';

export const PRIMARY_MODEL = 'googleai/gemini-3.1-flash-lite-preview';
export const FALLBACK_MODEL = 'googleai/gemini-2.5-flash';

const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("Missing API Key: Ensure GOOGLE_GENAI_API_KEY is set in environment variables.");
}

export const ai = genkit({
  plugins: [googleAI({ apiKey })],
  model: PRIMARY_MODEL,
});

/**
 * Executes a generation with an automatic fallback mechanism.
 * If the primary model fails (e.g. 503 Service Unavailable), 
 * it retries exactly once using the fallback model.
 */
export async function generateWithFallback<O extends z.ZodTypeAny = z.ZodTypeAny>(
  options: Parameters<typeof ai.generate>[0]
) {
  try {
    // Attempt 1: Use the primary model (or the model specified in options)
    const genOptions = await options;
    return await ai.generate({
      ...genOptions,
      model: (genOptions as any).model || PRIMARY_MODEL
    });
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const isRetryable = errorMsg.includes('503') || 
                        errorMsg.includes('Service Unavailable') || 
                        errorMsg.includes('429') || 
                        errorMsg.includes('Quota exceeded') ||
                        errorMsg.includes('validation') ||
                        errorMsg.includes('schema') ||
                        errorMsg.includes('blocked') ||
                        errorMsg.includes('safety');

    if (isRetryable) {
      console.warn(`[Genkit] Primary model failed (${errorMsg}). Retrying with fallback: ${FALLBACK_MODEL}`);
      
      // Attempt 2: Use the designated fallback model
      return await ai.generate({
        ...options,
        model: FALLBACK_MODEL
      });
    }

    // If it's not a retryable error, rethrow
    throw error;
  }
}
