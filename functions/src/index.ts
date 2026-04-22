import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFunctions } from "firebase-admin/functions";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import axios from "axios";
import { tavily } from "@tavily/core";

// 1. Lazy load dependencies
let EbayService: any;
let genkit: any;
let googleAI: any;
let z: any;

async function loadEbay() {
  if (!EbayService) {
    const mod = await import("./ebay");
    EbayService = mod.EbayService;
  }
  return EbayService;
}

async function loadGenkit() {
  if (!genkit) {
    const genkitMod = await import("genkit");
    const aiMod = await import("@genkit-ai/google-genai");
    genkit = genkitMod.genkit;
    z = genkitMod.z;
    googleAI = aiMod.googleAI;
  }
  return { genkit, z, googleAI };
}

// 2. Secrets
const GOOGLE_GENAI_API_KEY = defineSecret("GOOGLE_GENAI_API_KEY");
const EBAY_CLIENT_ID = defineSecret("EBAY_CLIENT_ID");
const EBAY_CLIENT_SECRET = defineSecret("EBAY_CLIENT_SECRET");
const EBAY_ENV = defineSecret("EBAY_ENV");
const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");
const TAVILY_API_KEY = defineSecret("TAVILY_API_KEY");
const EBAY_USER_REFRESH_TOKEN = defineSecret("EBAY_USER_REFRESH_TOKEN");

admin.initializeApp();

// 3. Helper: Clean query for eBay
function cleanEbayQuery(text: string): string {
  return text.replace(/compare|versus|price|market|sentiment|outlook|what|is|the|sold|of|a/gi, '')
    .replace(/\s\s+/g, ' ')
    .trim();
}

// --- SCANNER LOGIC (Original) ---

export const enqueueGeminiTask = onDocumentCreated("scanJobs/{jobId}", async (event) => {
  const jobId = event.params.jobId;
  const jobData = event.data?.data();
  if (!jobData || jobData.status !== "pending") return;

  const queue = getFunctions().taskQueue("locations/us-central1/functions/geminiProcessingQueue");
  try {
    await queue.enqueue({ jobId }, { scheduleDelaySeconds: 0, oidcToken: {} } as any);
    await event.data?.ref.update({ status: "queued", updatedAt: new Date().toISOString() });
  } catch (error) { console.error("Enqueue failed", error); }
});

export const geminiProcessingQueue = onTaskDispatched({
  secrets: [GOOGLE_GENAI_API_KEY, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV],
  memory: "1GiB",
  timeoutSeconds: 300,
}, async (request) => {
  const { jobId } = request.data as { jobId: string };
  const db = admin.firestore();
  const jobRef = db.collection("scanJobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) return;

  const jobData = jobSnap.data()!;

  try {
    await jobRef.update({ status: "processing", updatedAt: new Date().toISOString() });
    const { genkit: genkitFunc, googleAI: googleAIFunc, z: zod } = await loadGenkit();
    const ai = genkitFunc({
      plugins: [googleAIFunc({ apiKey: GOOGLE_GENAI_API_KEY.value() })],
      model: "googleai/gemini-3.1-flash-lite-preview",
    });

    // Output Schema (Strict OCR - Now with Grading)
    const ScanOutputSchema = zod.object({
      year: zod.string(),
      brand: zod.string(),
      player: zod.string(),
      cardNumber: zod.string(),
      parallel: zod.string().default("Base"),
      condition: zod.string().default("Raw"),
      grade: zod.string().optional(),
      grader: zod.string().optional(),
    });

    const promptText = `You are an expert OCR engine for trading cards. 
Analyze the image(s) and return the year, brand, player, card number, parallel, and condition.

Identify if the card is in a graded slab (PSA, BGS, SGC, CGC). If so, extract the company and the numerical grade (e.g., PSA 10). If raw, set to null.

STRICT RULE: Do NOT guess or provide any market value or pricing data. Your job is only to read the card's text and identify it.`;

    const parts: any[] = [{ text: promptText }];

    if (jobData.type === "image-scan") {
      parts.push({ media: { url: jobData.payload.frontPhotoDataUri, contentType: "image/jpeg" } });
      if (jobData.payload.backPhotoDataUri) {
        parts.push({ media: { url: jobData.payload.backPhotoDataUri, contentType: "image/jpeg" } });
      }
    }

    const response = await ai.generate({
      prompt: parts,
      output: { schema: ScanOutputSchema },
      config: { temperature: 0.1 }
    });

    const result = response.output as any;

    if (!result) {
      throw new Error("AI failed to generate a valid structured output.");
    }

    // --- Post-AI Valuation: Fetch Real-Time eBay Active Data ---
    try {
      const EbayServiceClass = await loadEbay();
      const ebay = new EbayServiceClass(
        EBAY_CLIENT_ID.value(),
        EBAY_CLIENT_SECRET.value(),
        EBAY_ENV.value()
      );

      // 1. Search Sanitizer Helper (Strict Regex Purge)
      const sanitizeQuery = (parts: any[]) => {
        const regex = /null|undefined|Base Set|#/gi;
        return parts
          .filter(p => p !== null && p !== undefined && String(p).toLowerCase() !== "null" && String(p).toLowerCase() !== "undefined")
          .map(p => String(p).replace(regex, "").trim())
          .filter(p => p.length > 0)
          .join(" ")
          .replace(/\s\s+/g, ' ')
          .trim();
      };

      console.log(`[Scanner] Processing Job ${jobId} (Env: ${EBAY_ENV.value()})`);

      // 2. Grade Handling: Only include if numerical (1-10)
      const hasNumericalGrade = result.grade && /^\d+(\.\d+)?$/.test(String(result.grade));
      const validGrader = hasNumericalGrade ? result.grader : null;
      const validGrade = hasNumericalGrade ? result.grade : null;

      // 3. Brand Alias Mapping
      const brandMapping: Record<string, string> = {
        "In The Game": "ITG",
        "Upper Deck": "UD"
      };
      const brandAlias = brandMapping[result.brand] || result.brand;

      // 4. Define Searching Tiers
      const isRookieYear = result.year === "2015" || result.year === "2016";
      const tiers = [
        // Tier 1: The Pro (Precision)
        sanitizeQuery([result.year, result.brand, result.player, result.cardNumber, result.parallel, validGrader, validGrade]),
        // Tier 2: The Collector (Brand Alias)
        sanitizeQuery([brandAlias, result.player, result.cardNumber]),
        // Tier 3: The Rookie (Conditional RC)
        sanitizeQuery([result.player, result.cardNumber, isRookieYear ? "RC" : ""]),
        // Tier 4: The Hammer (Nuclear)
        sanitizeQuery([result.player, result.cardNumber])
      ];

      let activeResults: any = null;
      let successfulTier = 0;

      for (let i = 0; i < tiers.length; i++) {
        let query = tiers[i];
        
        // Brand Cleaning fallback
        if (query.toLowerCase().includes("in the game")) {
          query = query.replace(/in the game/gi, "ITG");
        }

        // McDavid Specialty Logic
        if (result.brand === "Upper Deck" && result.cardNumber?.startsWith("CM")) {
          query = `${query} Connor McDavid Collection`;
        }

        console.log(`[Scanner] Tier ${i + 1} Attempt: "${query}"`);

        activeResults = await ebay.searchActiveItems(query);
        
        if (activeResults?.itemSummaries && activeResults.itemSummaries.length > 0) {
          successfulTier = i + 1;
          
          // Special note if graded card fell back to raw pricing
          if (validGrader && validGrade && successfulTier >= 2 && !query.includes(validGrader)) {
            result.marketNote = "No graded listings found; showing Raw market average.";
          }
          break;
        }
      }
      
      let estimatedMarketValue = 0;
      if (successfulTier > 0) {
        const summaries = activeResults.itemSummaries;
        const pricesWithShipping: number[] = [];

        for (const item of summaries) {
          const basePrice = parseFloat(item.price.value);
          const shippingCost = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || "0");
          if (!isNaN(basePrice)) {
            pricesWithShipping.push(basePrice + shippingCost);
          }
        }
        
        if (pricesWithShipping.length > 0) {
          // 1. Price Range Metrics (Active BIN)
          result.lowestActive = Math.min(...pricesWithShipping);
          result.highestActive = Math.max(...pricesWithShipping);
          result.averageActive = Math.round((pricesWithShipping.reduce((a, b) => a + b, 0) / pricesWithShipping.length) * 100) / 100;

          // 2. Set Estimated Value to simple average of active Buy It Nows
          estimatedMarketValue = result.averageActive;

          console.log(`[Scanner] Tier ${successfulTier} success. Active Avg (Price+Ship): $${estimatedMarketValue}`);
        }
      } else {
        console.log(`[Scanner] All 4 Search Tiers failed to find active listings.`);
      }

      // Manually append the calculated value
      result.estimatedMarketValue = estimatedMarketValue;
    } catch (ebayErr) {
      console.error("[Scanner] eBay valuation failed:", ebayErr);
      result.estimatedMarketValue = 0;
    }

    await jobRef.update({
      status: "completed",
      result,
      updatedAt: new Date().toISOString(),
    });

    console.log(`Job ${jobId} completed successfully with value: $${result.estimatedMarketValue}`);
  } catch (error: any) {
    console.error(`Error processing job ${jobId}:`, error);
    await jobRef.update({
      status: "error",
      error: error.message || "Unknown error during processing",
      updatedAt: new Date().toISOString(),
    });
  }
});

// --- ADVISOR LOGIC (New & Improved) ---

export const onMessageMarketVibe = onDocumentCreated({
  document: "messages/{messageId}",
  secrets: [OPENROUTER_API_KEY, TAVILY_API_KEY, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV],
}, async (event) => {
  const messageData = event.data?.data();
  if (!messageData || messageData.marketVibe) return;

  try {
    // A. Tavily News
    let marketIntelligence = "No news found.";
    const tvly = tavily({ apiKey: TAVILY_API_KEY.value() });
    const searchResult = await tvly.search(messageData.text, { topic: "news", maxResults: 2 });
    marketIntelligence = searchResult.results.map((r: any) => `Source: ${r.title}\n${r.content}`).join("\n\n");

    // B. eBay Realized Sales
    const EbayServiceClass = await loadEbay();
    const ebay = new EbayServiceClass(EBAY_CLIENT_ID.value(), EBAY_CLIENT_SECRET.value(), EBAY_ENV.value());
    const searchKeyword = cleanEbayQuery(messageData.text);
    let realizedValueReport = "No sales data found.";

    const soldResults = await ebay.searchActiveItems(searchKeyword);
    if (soldResults?.itemSummaries) {
      const prices = soldResults.itemSummaries.map((i: any) => parseFloat(i.price.value));
      const avg = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
      realizedValueReport = `Based on ${prices.length} active listings, Current Value is $${avg.toFixed(2)}.`;
    }

    // C. AI Response
    const userPrompt = `News: ${marketIntelligence}\nRealized Sales: ${realizedValueReport}\nUser: ${messageData.text}`;
    const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
      model: "inflection/inflection-3-pi",
      messages: [{ role: "system", content: "You are a Senior Card Advisor. Compare News vs. Sold Prices." }, { role: "user", content: userPrompt }],
    }, { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY.value()}` } });

    await event.data?.ref.update({ marketVibe: response.data.choices[0]?.message?.content, updatedAt: new Date().toISOString() });
  } catch (error) { console.error("Advisor failed", error); }
});

// --- MAINTENANCE LOGIC (Original) ---

export const dailyPriceSnapshot = onSchedule({ schedule: "0 0 * * *", timeZone: "UTC" }, async () => {
  console.log("Taking daily snapshots...");
});

export const scheduledMarketRefresh = onSchedule({ schedule: "0 8 * * *", timeZone: "America/New_York" }, async () => {
  console.log("Enqueuing cards for refresh...");
});

export const refreshMarketCardTask = onTaskDispatched({
  secrets: [EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV],
  rateLimits: { maxConcurrentDispatches: 5 },
}, async (request) => {
  console.log("Refreshing card value...");
});