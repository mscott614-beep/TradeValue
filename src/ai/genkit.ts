import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ollama } from 'genkitx-ollama';
import { z } from 'zod';

const useLocalLlm = process.env.USE_LOCAL_LLM === 'true';
const localModel = process.env.LOCAL_LLM_MODEL || 'gemma4:12b';
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
      requestHeaders: {
        'ngrok-skip-browser-warning': 'true',
        'Bypass-Tunnel-Reminder': 'true',
      },
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
  options: Parameters<typeof ai.generate>[0] & { timeout?: number }
) {
  const genOptions = await options;
  const model = (genOptions as any).model || PRIMARY_MODEL;
  const hasSchema = !!genOptions.output?.schema;

  const finalOptions: any = {
    ...genOptions,
    model
  };

  if (useLocalLlm && model.startsWith('ollama/')) {
    delete finalOptions.output;
  }

  const runGen = async (opts: any) => {
    const response = await ai.generate(opts);
    if (useLocalLlm && opts.model.startsWith('ollama/') && hasSchema && !response.output && response.text) {
      try {
        const text = response.text;
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        
        let jsonStr = '';
        if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
          jsonStr = text.substring(firstBracket, lastBracket + 1);
        } else if (firstBrace !== -1) {
          jsonStr = text.substring(firstBrace, lastBrace + 1);
        }
        
        if (jsonStr) {
          Object.defineProperty(response, 'output', {
            value: JSON.parse(jsonStr),
            writable: true,
            configurable: true,
            enumerable: true
          });
        }
      } catch (e) {
        console.error("[Genkit] Failed to parse Ollama text response as structured output:", e);
      }
    }
    return response;
  };

  const runWithTimeout = async (opts: any, timeoutMs: number) => {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Model generation timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([runGen(opts), timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (err) {
      clearTimeout(timeoutId!);
      throw err;
    }
  };

  const timeoutMs = (genOptions as any).timeout || (useLocalLlm ? 240000 : 60000);

  try {
    // Attempt 1: Use the primary model (or the model specified in options)
    return await runWithTimeout(finalOptions, timeoutMs);
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
                        errorMsg.includes('safety') ||
                        errorMsg.includes('timed out');

    if (isRetryable && PRIMARY_MODEL !== FALLBACK_MODEL) {
      console.warn(`[Genkit] Primary model failed (${errorMsg}). Retrying with fallback: ${FALLBACK_MODEL}`);
      
      const fallbackOptions: any = {
        ...genOptions,
        model: FALLBACK_MODEL
      };
      if (useLocalLlm && FALLBACK_MODEL.startsWith('ollama/')) {
        delete fallbackOptions.output;
      }
      
      // Attempt 2: Use the designated fallback model
      return await runWithTimeout(fallbackOptions, timeoutMs);
    }

    // If it's not a retryable error, rethrow
    throw error;
  }
}
