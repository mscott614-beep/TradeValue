import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

export const PRIMARY_MODEL = 'googleai/gemini-3.1-flash-lite-preview';
export const FALLBACK_MODEL = 'googleai/gemini-2.5-flash';

export const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GEMINI_API_KEY })],
  model: PRIMARY_MODEL,
});
