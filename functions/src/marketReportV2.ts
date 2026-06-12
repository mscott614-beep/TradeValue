import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { buildInstitutionalReportPrompt } from "./institutional-report-prompt";

const GOOGLE_GENAI_API_KEY = defineSecret("GOOGLE_GENAI_API_KEY");

const useLocalLlm = process.env.USE_LOCAL_LLM === 'true';
const localModel = process.env.LOCAL_LLM_MODEL || 'gemma4:26b';

const PRIMARY_MODEL = useLocalLlm ? `ollama/${localModel}` : "googleai/gemini-3.5-flash";
const FALLBACK_MODEL = useLocalLlm ? `ollama/${localModel}` : "googleai/gemini-2.5-flash";

/**
 * Streaming institutional market report (aligned with weekly newsletter architecture).
 */
export const marketReportV2 = onRequest({
  region: "us-east4",
  secrets: [GOOGLE_GENAI_API_KEY],
  memory: "1GiB",
  timeoutSeconds: 120,
  maxInstances: 2,
  concurrency: 1,
  cors: true,
}, async (req, res) => {
  const { topic, trendingData } = req.body ?? {};
  const systemPrompt = buildInstitutionalReportPrompt({ topic, trendingData });

  try {
    const { genkit } = await import("genkit");
    const { googleAI } = await import("@genkit-ai/googleai");
    
    const plugins: any[] = [googleAI({ apiKey: GOOGLE_GENAI_API_KEY.value() })];
    if (useLocalLlm) {
      try {
        const { ollama } = await import("genkitx-ollama");
        plugins.push(
          ollama({
            models: [{ name: localModel }],
            serverAddress: process.env.LOCAL_LLM_URL || 'http://localhost:11434',
          })
        );
      } catch(e) {
        console.warn("genkitx-ollama not found, skipping local LLM plugin load");
      }
    }

    const ai = genkit({
      plugins,
    });

    const models = [PRIMARY_MODEL, FALLBACK_MODEL];
    let lastError = "";

    for (const modelName of models) {
      try {
        console.log(`[InstitutionalReport] Trying ${modelName}...`);

        const response = await ai.generateStream({
          model: modelName,
          prompt: systemPrompt,
          config: { temperature: 0.25 },
        });

        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");

        for await (const chunk of response.stream) {
          if (chunk.text) {
            res.write(chunk.text);
          }
        }

        res.write(`\n\n---\n*TradeValue Institutional Report | Model: ${modelName}*`);
        res.end();
        console.log(`[InstitutionalReport] Complete with ${modelName}.`);
        return;
      } catch (modelErr: unknown) {
        const err = modelErr as { message?: string };
        const errorMsg = err?.message || "Unknown model error";
        lastError = errorMsg;

        const isBillingOrQuotaExhausted =
          errorMsg.includes("prepayment credits are depleted") ||
          errorMsg.includes("Quota exceeded") ||
          (errorMsg.includes("429") &&
            (errorMsg.includes("billing") || errorMsg.includes("Too Many Requests")));

        if (isBillingOrQuotaExhausted) {
          console.error(`[InstitutionalReport] Billing/quota exhausted: ${errorMsg}`);
          if (!res.headersSent) {
            res.status(429).json({
              error: "quota_exhausted",
              message: "Gemini quota or billing limit reached. Try again after credits are restored.",
            });
          } else {
            res.write("\n\n[NOTICE]: Stream interrupted — quota exhausted.");
            res.end();
          }
          return;
        }

        console.error(`[InstitutionalReport] ${modelName} failed: ${errorMsg}`);
        if (res.headersSent) {
          res.write("\n\n[NOTICE]: Stream interrupted.");
          res.end();
          return;
        }
      }
    }

    console.error("[InstitutionalReport] All models exhausted:", lastError);
    res.status(503).json({
      error: "report_engine_unavailable",
      message: "All AI models are currently unavailable. Please try again shortly.",
      detail: lastError,
    });
  } catch (fatalError: unknown) {
    const err = fatalError as { message?: string };
    const msg = err?.message || "Institutional report engine internal error.";
    console.error("[InstitutionalReport] Fatal error:", msg);
    if (!res.headersSent) {
      res.status(500).json({ error: "report_engine_fatal", message: msg });
    } else {
      res.write(`\n\n[FATAL]: ${msg}`);
      res.end();
    }
  }
});
