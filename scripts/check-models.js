/**
 * Local Gemini connectivity check (matches src/ai/genkit.ts model stack).
 * Usage: npm run check:models
 * Loads .env.local then .env from repo root.
 */
const path = require("path");
const { genkit } = require("genkit");
const { googleAI } = require("@genkit-ai/googleai");
const dotenv = require("dotenv");

const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

const PRIMARY_MODEL = "googleai/gemini-3.5-flash";
const FALLBACK_MODEL = "googleai/gemini-2.5-flash";

async function tryModel(ai, modelName) {
  console.log(`\nChecking ${modelName}...`);
  const response = await ai.generate({
    model: modelName,
    prompt: 'Reply with exactly: "ok"',
    config: { temperature: 0 },
  });
  console.log(`  Success (${modelName}):`, (response.text || "").trim().slice(0, 80));
  return true;
}

async function checkModel() {
  const apiKey =
    process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error(
      "Missing API key. Set GOOGLE_GENAI_API_KEY or GEMINI_API_KEY in .env.local (see .env.example)."
    );
    process.exit(1);
  }

  const ai = genkit({
    plugins: [googleAI({ apiKey })],
  });

  try {
    await tryModel(ai, PRIMARY_MODEL);
    console.log("\nPrimary model OK.");
    process.exit(0);
  } catch (primaryErr) {
    console.error(`Primary failed: ${primaryErr.message}`);
  }

  try {
    await tryModel(ai, FALLBACK_MODEL);
    console.log("\nFallback model OK (primary unavailable).");
    process.exit(0);
  } catch (fallbackErr) {
    console.error(`Fallback failed: ${fallbackErr.message}`);
    process.exit(1);
  }
}

checkModel();
