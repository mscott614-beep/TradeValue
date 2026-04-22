"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshMarketCardTask = exports.scheduledMarketRefresh = exports.dailyPriceSnapshot = exports.onMessageMarketVibe = exports.geminiProcessingQueue = exports.enqueueGeminiTask = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const tasks_1 = require("firebase-functions/v2/tasks");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const functions_1 = require("firebase-admin/functions");
const admin = __importStar(require("firebase-admin"));
const params_1 = require("firebase-functions/params");
const axios_1 = __importDefault(require("axios"));
const core_1 = require("@tavily/core");
// 1. Lazy load dependencies
let EbayService;
let genkit;
let googleAI;
let z;
async function loadEbay() {
    if (!EbayService) {
        const mod = await Promise.resolve().then(() => __importStar(require("./ebay")));
        EbayService = mod.EbayService;
    }
    return EbayService;
}
async function loadGenkit() {
    if (!genkit) {
        const genkitMod = await Promise.resolve().then(() => __importStar(require("genkit")));
        const aiMod = await Promise.resolve().then(() => __importStar(require("@genkit-ai/google-genai")));
        genkit = genkitMod.genkit;
        z = genkitMod.z;
        googleAI = aiMod.googleAI;
    }
    return { genkit, z, googleAI };
}
// 2. Secrets
const GOOGLE_GENAI_API_KEY = (0, params_1.defineSecret)("GOOGLE_GENAI_API_KEY");
const EBAY_CLIENT_ID = (0, params_1.defineSecret)("EBAY_CLIENT_ID");
const EBAY_CLIENT_SECRET = (0, params_1.defineSecret)("EBAY_CLIENT_SECRET");
const EBAY_ENV = (0, params_1.defineSecret)("EBAY_ENV");
const OPENROUTER_API_KEY = (0, params_1.defineSecret)("OPENROUTER_API_KEY");
const TAVILY_API_KEY = (0, params_1.defineSecret)("TAVILY_API_KEY");
const EBAY_USER_REFRESH_TOKEN = (0, params_1.defineSecret)("EBAY_USER_REFRESH_TOKEN");
admin.initializeApp();
// 3. Helper: Clean query for eBay
function cleanEbayQuery(text) {
    return text.replace(/compare|versus|price|market|sentiment|outlook|what|is|the|sold|of|a/gi, '')
        .replace(/\s\s+/g, ' ')
        .trim();
}
// --- SCANNER LOGIC (Original) ---
exports.enqueueGeminiTask = (0, firestore_1.onDocumentCreated)("scanJobs/{jobId}", async (event) => {
    const jobId = event.params.jobId;
    const jobData = event.data?.data();
    if (!jobData || jobData.status !== "pending")
        return;
    const queue = (0, functions_1.getFunctions)().taskQueue("locations/us-central1/functions/geminiProcessingQueue");
    try {
        await queue.enqueue({ jobId }, { scheduleDelaySeconds: 0, oidcToken: {} });
        await event.data?.ref.update({ status: "queued", updatedAt: new Date().toISOString() });
    }
    catch (error) {
        console.error("Enqueue failed", error);
    }
});
exports.geminiProcessingQueue = (0, tasks_1.onTaskDispatched)({
    secrets: [GOOGLE_GENAI_API_KEY, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV, EBAY_USER_REFRESH_TOKEN],
    memory: "1GiB",
    timeoutSeconds: 300,
}, async (request) => {
    const { jobId } = request.data;
    const db = admin.firestore();
    const jobRef = db.collection("scanJobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists)
        return;
    const jobData = jobSnap.data();
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
        const parts = [{ text: promptText }];
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
        const result = response.output;
        if (!result) {
            throw new Error("AI failed to generate a valid structured output.");
        }
        // --- Post-AI Valuation: Fetch Real-Time eBay Sold Data ---
        try {
            const EbayServiceClass = await loadEbay();
            const ebay = new EbayServiceClass(EBAY_CLIENT_ID.value(), EBAY_CLIENT_SECRET.value(), EBAY_ENV.value());
            // 1. Fuzzy Query Helper
            const fuzzyClean = (t) => t.replace(/Base Set|#|Standard/gi, '').replace(/\s\s+/g, ' ').trim();
            // 2. Define Searching Tiers
            const isGraded = result.grader && result.grade;
            const gradingStr = isGraded ? `${result.grader} ${result.grade}` : "";
            const tiers = [
                fuzzyClean(`${result.year} ${result.brand} ${result.player} ${result.cardNumber} ${gradingStr}`), // Tier 1: Strict
                fuzzyClean(`${result.brand} ${result.player} ${result.cardNumber}`), // Tier 2: Clean
                `${result.player} ${result.brand} ${result.cardNumber}` // Tier 3: Broad
            ];
            let soldResults = null;
            let successfulTier = 0;
            for (let i = 0; i < tiers.length; i++) {
                let query = tiers[i];
                // Brand Cleaning for "In The Game"
                if (query.toLowerCase().includes("in the game")) {
                    query = query.replace(/in the game/gi, "ITG");
                }
                // McDavid Specialty Logic: CM numbers are from the "Connor McDavid Collection"
                if (result.brand === "Upper Deck" && result.cardNumber?.startsWith("CM")) {
                    query = `${query} Connor McDavid Collection`;
                }
                console.log(`[Scanner] Tier ${i + 1} Search: "${query}"`);
                soldResults = await ebay.searchSoldItems(query, EBAY_USER_REFRESH_TOKEN.value());
                if (soldResults?.itemSummaries && soldResults.itemSummaries.length > 0) {
                    successfulTier = i + 1;
                    // Special note if graded card fell back to raw pricing
                    if (isGraded && successfulTier >= 2 && !query.includes(result.grader)) {
                        result.marketNote = "No graded sales found; showing Raw market average.";
                    }
                    break;
                }
            }
            let estimatedMarketValue = 0;
            if (successfulTier > 0) {
                const prices = soldResults.itemSummaries.map((i) => parseFloat(i.price.value)).filter((p) => !isNaN(p) && p > 0);
                if (prices.length > 0) {
                    // 1. Price Range Metrics
                    result.lowestSold = Math.min(...prices);
                    result.highestSold = Math.max(...prices);
                    result.averageSold = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
                    // 2. Weighted Average Calculation
                    const recent3 = prices.slice(0, 3);
                    const others = prices.slice(3);
                    let weightedAvg = 0;
                    if (recent3.length > 0) {
                        const avgRecent = recent3.reduce((a, b) => a + b, 0) / recent3.length;
                        if (others.length > 0) {
                            const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
                            weightedAvg = (avgRecent * 0.7) + (avgOthers * 0.3);
                        }
                        else {
                            weightedAvg = avgRecent;
                        }
                    }
                    estimatedMarketValue = Math.round(weightedAvg * 100) / 100;
                    // 3. Market Lag Disclaimer
                    const latestSaleDateStr = soldResults.itemSummaries[0]?.lastSoldDate;
                    if (latestSaleDateStr) {
                        const latestSaleDate = new Date(latestSaleDateStr);
                        const diffHours = (Date.now() - latestSaleDate.getTime()) / (1000 * 60 * 60);
                        if (diffHours > 48) {
                            result.marketNote = "Market data may have a 48h lag; recent intraday sales not yet reflected.";
                        }
                    }
                    console.log(`[Scanner] Tier ${successfulTier} success. Valuation: $${estimatedMarketValue}`);
                }
            }
            else {
                console.log(`[Scanner] All 3 Search Tiers failed. Setting value to 0.`);
            }
            // Manually append the calculated value
            result.estimatedMarketValue = estimatedMarketValue;
        }
        catch (ebayErr) {
            console.error("[Scanner] eBay valuation failed:", ebayErr);
            result.estimatedMarketValue = 0;
        }
        await jobRef.update({
            status: "completed",
            result,
            updatedAt: new Date().toISOString(),
        });
        console.log(`Job ${jobId} completed successfully with value: $${result.estimatedMarketValue}`);
    }
    catch (error) {
        console.error(`Error processing job ${jobId}:`, error);
        await jobRef.update({
            status: "error",
            error: error.message || "Unknown error during processing",
            updatedAt: new Date().toISOString(),
        });
    }
});
// --- ADVISOR LOGIC (New & Improved) ---
exports.onMessageMarketVibe = (0, firestore_1.onDocumentCreated)({
    document: "messages/{messageId}",
    secrets: [OPENROUTER_API_KEY, TAVILY_API_KEY, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV, EBAY_USER_REFRESH_TOKEN],
}, async (event) => {
    const messageData = event.data?.data();
    if (!messageData || messageData.marketVibe)
        return;
    try {
        // A. Tavily News
        let marketIntelligence = "No news found.";
        const tvly = (0, core_1.tavily)({ apiKey: TAVILY_API_KEY.value() });
        const searchResult = await tvly.search(messageData.text, { topic: "news", maxResults: 2 });
        marketIntelligence = searchResult.results.map((r) => `Source: ${r.title}\n${r.content}`).join("\n\n");
        // B. eBay Realized Sales
        const EbayServiceClass = await loadEbay();
        const ebay = new EbayServiceClass(EBAY_CLIENT_ID.value(), EBAY_CLIENT_SECRET.value(), EBAY_ENV.value());
        const searchKeyword = cleanEbayQuery(messageData.text);
        let realizedValueReport = "No sales data found.";
        const soldResults = await ebay.searchSoldItems(searchKeyword, EBAY_USER_REFRESH_TOKEN.value());
        if (soldResults?.itemSummaries) {
            const prices = soldResults.itemSummaries.map((i) => parseFloat(i.price.value));
            const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
            realizedValueReport = `Based on ${prices.length} recent sales, Realized Value is $${avg.toFixed(2)}.`;
        }
        // C. AI Response
        const userPrompt = `News: ${marketIntelligence}\nRealized Sales: ${realizedValueReport}\nUser: ${messageData.text}`;
        const response = await axios_1.default.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "inflection/inflection-3-pi",
            messages: [{ role: "system", content: "You are a Senior Card Advisor. Compare News vs. Sold Prices." }, { role: "user", content: userPrompt }],
        }, { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY.value()}` } });
        await event.data?.ref.update({ marketVibe: response.data.choices[0]?.message?.content, updatedAt: new Date().toISOString() });
    }
    catch (error) {
        console.error("Advisor failed", error);
    }
});
// --- MAINTENANCE LOGIC (Original) ---
exports.dailyPriceSnapshot = (0, scheduler_1.onSchedule)({ schedule: "0 0 * * *", timeZone: "UTC" }, async () => {
    console.log("Taking daily snapshots...");
});
exports.scheduledMarketRefresh = (0, scheduler_1.onSchedule)({ schedule: "0 8 * * *", timeZone: "America/New_York" }, async () => {
    console.log("Enqueuing cards for refresh...");
});
exports.refreshMarketCardTask = (0, tasks_1.onTaskDispatched)({
    secrets: [EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV],
    rateLimits: { maxConcurrentDispatches: 5 },
}, async (request) => {
    console.log("Refreshing card value...");
});
//# sourceMappingURL=index.js.map