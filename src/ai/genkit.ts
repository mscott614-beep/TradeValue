import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ollama } from 'genkitx-ollama';
import { z } from 'zod';

const useLocalLlm = process.env.USE_LOCAL_LLM === 'true';
const localModel = process.env.LOCAL_LLM_MODEL || 'gemma4:26b';
const localUrl = process.env.LOCAL_LLM_URL || 'http://localhost:11434';

export const PRIMARY_MODEL = useLocalLlm ? `ollama/${localModel}` : 'googleai/gemini-3.5-flash';
export const FALLBACK_MODEL = useLocalLlm ? `ollama/${localModel}` : 'googleai/gemini-2.5-flash';

const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey && !useLocalLlm) {
  throw new Error(
    "Missing API Key: set GOOGLE_GENAI_API_KEY (Functions/Cloud Run) or GEMINI_API_KEY (App Hosting) in environment variables."
  );
}

const plugins: any[] = [googleAI({ apiKey: apiKey || 'dummy-key' })];
if (useLocalLlm) {
  plugins.push(
    ollama({
      models: [{ name: localModel }],
      serverAddress: localUrl,
    })
  );
}

export const ai = genkit({
  plugins,
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
    const isBillingOrQuotaExhausted =
      errorMsg.includes("prepayment credits are depleted") ||
      errorMsg.includes("Quota exceeded") ||
      (errorMsg.includes("429") &&
        (errorMsg.includes("billing") || errorMsg.includes("Too Many Requests")));

    if (isBillingOrQuotaExhausted) {
      throw error;
    }

    const isRetryable = errorMsg.includes('503') || 
                        errorMsg.includes('Service Unavailable') || 
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
