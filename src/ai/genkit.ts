import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'zod';

export const PRIMARY_MODEL = 'googleai/gemini-3.1-flash-lite-preview';
export const FALLBACK_MODEL = 'googleai/gemini-2.5-flash';

export const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GEMINI_API_KEY })],
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
    return await ai.generate({
      ...options,
      model: options.model || PRIMARY_MODEL
    });
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const isRetryable = errorMsg.includes('503') || 
                        errorMsg.includes('Service Unavailable') || 
                        errorMsg.includes('429') || 
                        errorMsg.includes('Quota exceeded');

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
