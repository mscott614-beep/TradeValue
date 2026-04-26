import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const GOOGLE_GENAI_API_KEY = defineSecret("GOOGLE_GENAI_API_KEY");

/**
 * Shadow Market Intelligence Engine v2
 * Genkit-based streaming with the model names that are confirmed working.
 */
export const marketReportV2 = onRequest({
  region: "us-east4",
  secrets: [GOOGLE_GENAI_API_KEY],
  memory: "1GiB",
  timeoutSeconds: 120,
  maxInstances: 5,
  concurrency: 1,
  cors: true,
}, async (req, res) => {
  const { topic, trendingData } = req.body;

  const focusContext = topic
    ? `Specific interest: ${topic}.`
    : `General High-end Sportscard and TCG Market.`;

  const trendingContext = trendingData && trendingData.length > 0
    ? `CURRENT MARKET MOVERS:\n${JSON.stringify(trendingData.slice(0, 4), null, 2)}`
    : "";

  const systemPrompt = `You are the "Shadow" Market Intelligence Engine v2 for TradeValue.
You provide premium, confidential market analysis for high-net-worth investors.

CONTEXT:
${focusContext}
${trendingContext}

CRITICAL FORMATTING RULES — FOLLOW EXACTLY:
1. Every Markdown table row MUST be on its own line. NEVER join rows with ||.
2. Place a blank line (empty line) BEFORE and AFTER every table block.
3. The pipe character | starts at column 0. Do NOT indent table rows.
4. The alignment row (| :--- | :--- | :--- |) MUST be on its own line immediately after the header row.

REPORT STRUCTURE — replace placeholder values with real data:

# EXECUTIVE SUMMARY

Write 3 concise sentences on current market state and sentiment for: ${focusContext}

# MARKET SNAPSHOT

| Card Name | Value | % Change |
| :--- | :--- | :--- |
| [Real Card Name] | [$Price] | [+/-%] |
| [Real Card Name] | [$Price] | [+/-%] |
| [Real Card Name] | [$Price] | [+/-%] |

## Market Sentiment

Analyze volume and liquidity trends based on your knowledge of this market.

## Hot Prospects

List 2-3 specific players or sets that are over-indexed for growth, with reasoning.

# RISK ANALYSIS

| Risk Factor | Impact | Analysis |
| :--- | :--- | :--- |
| Liquidity | [Low/Mod/High] | [Specific analysis for ${focusContext}] |
| Market Saturation | [Low/Mod/High] | [Specific analysis for ${focusContext}] |
| Player Performance | [Low/Mod/High] | [Specific analysis for ${focusContext}] |
| External Dynamics | [Low/Mod/High] | [Specific analysis for ${focusContext}] |

> **INVESTMENT CALL**: One bold, data-driven actionable sentence.

---
Shadow Intelligence Engine v2 | ${new Date().toLocaleDateString()}
`;

  try {
    const { genkit } = await import("genkit");
    const { googleAI } = await import("@genkit-ai/google-genai");

    const ai = genkit({
      plugins: [googleAI({ apiKey: GOOGLE_GENAI_API_KEY.value() })],
    });

    // Model names for Shadow Engine v2
    const models = [
      "googleai/gemini-3.1-flash-lite-preview",
      "googleai/gemini-2.5-flash-preview",
    ];

    let lastError = "";

    for (const modelName of models) {
      try {
        console.log(`[Shadow] Trying ${modelName}...`);

        const response = await ai.generateStream({
          model: modelName,
          prompt: systemPrompt,
          config: { temperature: 0.2 },
        });

        console.log(`[Shadow] Streaming with ${modelName}...`);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");

        for await (const chunk of response.stream) {
          // In Genkit, chunk.text is a property (string), not a method
          if (chunk.text) {
            res.write(chunk.text);
          }
        }

        res.write(`\n\n---\n*Shadow Engine v2 | Model: ${modelName.split("/")[1]}*`);
        res.end();
        console.log(`[Shadow] Report complete with ${modelName}.`);
        return;

      } catch (modelErr: any) {
        lastError = modelErr.message || "Unknown model error";
        console.error(`[Shadow] ${modelName} failed: ${lastError}`);
        if (res.headersSent) {
          res.write(`\n\n[NOTICE]: Stream interrupted.`);
          res.end();
          return;
        }
        continue;
      }
    }

    // All models failed
    console.error("[Shadow] All models exhausted:", lastError);
    res.status(503).json({
      error: "shadow_engine_unavailable",
      message: "All AI models are currently unavailable. Please try again shortly.",
      detail: lastError,
    });

  } catch (fatalError: any) {
    const msg = fatalError.message || "Shadow Engine internal error.";
    console.error("[Shadow] Fatal error:", msg);
    if (!res.headersSent) {
      res.status(500).json({ error: "shadow_engine_fatal", message: msg });
    } else {
      res.write(`\n\n[FATAL]: ${msg}`);
      res.end();
    }
  }
});
