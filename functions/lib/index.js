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
exports.marketReportV2 = exports.refreshMarketCardTask = exports.scheduledMarketRefresh = exports.dailyPriceSnapshot = exports.geminiProcessingQueue = exports.enqueueGeminiTask = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const tasks_1 = require("firebase-functions/v2/tasks");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const functions_1 = require("firebase-admin/functions");
const admin = __importStar(require("firebase-admin"));
const axios_1 = __importDefault(require("axios"));
const params_1 = require("firebase-functions/params");
// Lazy load heavy dependencies to avoid 10s initialization timeout
let genkit;
let vertexAI;
let z;
async function loadGenkit() {
    if (!genkit) {
        const genkitMod = await Promise.resolve().then(() => __importStar(require("genkit")));
        const aiMod = await Promise.resolve().then(() => __importStar(require("@genkit-ai/googleai")));
        genkit = genkitMod.genkit;
        z = genkitMod.z;
        vertexAI = aiMod.googleAI;
    }
    return { genkit, z, googleAI: vertexAI };
}
const PRIMARY_MODEL = 'googleai/gemini-3.1-flash-lite-preview';
const FALLBACK_MODEL = 'googleai/gemini-2.5-flash';
const GOOGLE_GENAI_API_KEY = (0, params_1.defineSecret)("GOOGLE_GENAI_API_KEY");
const EBAY_CLIENT_ID = (0, params_1.defineSecret)("EBAY_CLIENT_ID");
const EBAY_CLIENT_SECRET = (0, params_1.defineSecret)("EBAY_CLIENT_SECRET");
const EBAY_ENV = (0, params_1.defineSecret)("EBAY_ENV");
const AGENT_SERVICE_URL = (0, params_1.defineSecret)("AGENT_SERVICE_URL");
admin.initializeApp();
admin.firestore().settings({ ignoreUndefinedProperties: true });
// Producer: Triggered when a new job is created in 'scanJobs'
exports.enqueueGeminiTask = (0, firestore_1.onDocumentCreated)({
    document: "scanJobs/{jobId}",
    region: "us-east4"
}, async (event) => {
    const jobId = event.params.jobId;
    const jobData = event.data?.data();
    if (!jobData || jobData.status !== "pending") {
        console.log(`Job ${jobId} is not pending or missing data. Status: ${jobData?.status}`);
        return;
    }
    const queue = (0, functions_1.getFunctions)().taskQueue("locations/us-east4/functions/geminiProcessingQueue");
    try {
        await queue.enqueue({ jobId }, {
            scheduleDelaySeconds: 0,
            oidcToken: {},
        });
        await event.data?.ref.update({
            status: "queued",
            updatedAt: new Date().toISOString(),
        });
        console.log(`Successfully enqueued job ${jobId} to geminiProcessingQueue`);
    }
    catch (error) {
        console.error(`Failed to enqueue job ${jobId}:`, error);
        await event.data?.ref.update({
            status: "error",
            error: "Failed to enqueue task",
            updatedAt: new Date().toISOString(),
        });
    }
});
// Worker: Consumes the task and calls Gemini
exports.geminiProcessingQueue = (0, tasks_1.onTaskDispatched)({
    region: "us-east4",
    retryConfig: {
        maxAttempts: 5,
        minBackoffSeconds: 30,
    },
    rateLimits: {
        maxConcurrentDispatches: 1,
        maxDispatchesPerSecond: 1,
    },
    secrets: [GOOGLE_GENAI_API_KEY, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV, AGENT_SERVICE_URL],
    memory: "1GiB",
    timeoutSeconds: 300,
}, async (request) => {
    const { jobId } = request.data;
    console.log(`Worker processing job ${jobId}`);
    const db = admin.firestore();
    const jobRef = db.collection("scanJobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
        console.error(`Job ${jobId} not found`);
        return;
    }
    const jobData = jobSnap.data();
    if (jobData.status === "completed") {
        console.log(`Job ${jobId} already completed`);
        return;
    }
    try {
        await jobRef.update({
            status: "processing",
            updatedAt: new Date().toISOString(),
        });
        const { genkit, z, googleAI } = await loadGenkit();
        const ai = genkit({
            plugins: [googleAI({ apiKey: GOOGLE_GENAI_API_KEY.value() })],
        });
        const ScanOutputSchema = z.object({
            year: z.string().describe("Year of the card, e.g. 2015"),
            brand: z.string().describe("Brand of the card, e.g. Topps"),
            set: z.string().nullable().describe("Set name, e.g. Young Guns"),
            player: z.string().describe("Full name of the player. MUST NOT BE EMPTY."),
            cardNumber: z.string().describe("Card number, e.g. 201"),
            parallel: z.string().default("Base").describe("Parallel or variation, e.g. Silver Prizm"),
            grade: z.string().nullable(),
            grader: z.string().nullable(),
            conditionAssessment: z.enum(["Near Mint", "Excellent", "Very Good", "Good", "Poor"]).default("Near Mint").describe("Assess the raw condition from the photo.")
        });
        const promptText = `You are an expert trading card authenticator. 
Analyze the provided card image(s) and extract the exact details.
CRITICAL: You must return a valid JSON object matching the schema. 
Ensure the 'player' field is populated with the player's full name (e.g., "Connor McDavid").
If a value is not found, use null for nullable fields, but NEVER omit the 'player', 'year', 'brand', or 'cardNumber' fields.

Identify the card as accurately as possible. For hockey cards, prefer the full season format (e.g., "1980-81" instead of "1980").

Assess the raw condition of the card from the photo (Near Mint, Excellent, Very Good, Good, Poor). If it looks like a standard high-quality card, default to 'Near Mint'.

Look at the top of the card holder. If there is a professional grading label (PSA, BGS, SGC, CGC), identify the company (grader) and the numerical grade. If no label is present, set both to null.

Return a JSON object:
- year: The year or season of the card (prefer YYYY-YY for hockey).
- brand: The brand (e.g., Topps, Upper Deck).
- player: The name of the player.
- cardNumber: The card number (exactly as it appears).
- parallel: The variation or parallel (e.g., "Silver Prizm", "Base", "/99").
- grade: The numerical grade (e.g., "10", "9.5", "Authentic") or descriptive grade (e.g. "GEM MT"). ONLY if a professional grading label is visible.
- grader: The grading company (e.g., "PSA", "BGS", "SGC", "CGC") or null.
- conditionAssessment: Your best assessment of the raw condition.`;
        const parts = [{ text: promptText }];
        if (jobData.type === "image-scan") {
            parts.push({ media: { url: jobData.payload.frontPhotoDataUri, contentType: "image/jpeg" } });
            if (jobData.payload.backPhotoDataUri) {
                parts.push({ media: { url: jobData.payload.backPhotoDataUri, contentType: "image/jpeg" } });
            }
        }
        let response;
        try {
            console.log(`[Scanner] Processing with primary model: ${PRIMARY_MODEL}`);
            response = await ai.generate({
                model: PRIMARY_MODEL,
                prompt: parts,
                output: { schema: ScanOutputSchema },
                config: { temperature: 0.1, maxOutputTokens: 1024 }
            });
        }
        catch (err) {
            console.warn(`[Scanner] Primary model failed (${err.message}). Retrying with ${FALLBACK_MODEL}...`);
            response = await ai.generate({
                model: FALLBACK_MODEL,
                prompt: parts,
                output: { schema: ScanOutputSchema },
                config: { temperature: 0.1, maxOutputTokens: 1024 }
            });
        }
        const result = response.output;
        if (!result) {
            throw new Error("AI failed to generate a valid structured output.");
        }
        // --- Post-AI Enrichment: Call Python Agent for Instant Pricing ---
        try {
            console.log(`[Scanner] Calling Python Agent for real-time pricing: ${result.player}...`);
            const agentUrl = `${AGENT_SERVICE_URL.value().trim()}/value-card`;
            const agentResponse = await axios_1.default.post(agentUrl, {
                userId: jobData.userId,
                cardId: "SCAN_PREVIEW",
                cardDetails: {
                    year: result.year,
                    brand: result.brand,
                    set: result.set || "",
                    player: result.player,
                    cardNumber: result.cardNumber,
                    parallel: result.parallel,
                    grade: result.grade || "",
                    gradingCompany: result.grader || "",
                    conditionHint: result.conditionAssessment
                }
            }, {
                headers: { "Content-Type": "application/json" },
                timeout: 120000 // 120 seconds
            });
            const agentData = agentResponse.data;
            // Merge pricing data into result
            result.estimatedMarketValue = agentData.final_price || 0.99;
            // Fix year display if expanded by agent
            if (agentData.last_search_query) {
                const yearMatch = agentData.last_search_query.match(/^\d{4}-\d{2}/);
                if (yearMatch && result.year.length === 4) {
                    result.year = yearMatch[0];
                }
            }
            result.estimatedGrade = result.grade || result.conditionAssessment || "Raw";
            result.valuationMethod = agentData.valuation_method;
            result.lastSearchQuery = agentData.last_search_query;
            result.marketPrices = agentData.research_results;
        }
        catch (agentErr) {
            console.error(`[Scanner] Agent pricing failed: ${agentErr.message}`);
            result.estimatedMarketValue = 0.99;
            result.estimatedGrade = result.grade || result.conditionAssessment || "Raw";
        }
        await jobRef.update({
            status: "completed",
            result,
            updatedAt: new Date().toISOString(),
        });
        console.log(`Job ${jobId} completed successfully`);
    }
    catch (error) {
        console.error(`Error processing job ${jobId}:`, error);
        if (error.message?.includes("429") || error.message?.includes("Quota")) {
            // Reset status to queued so the retry will pick it up properly
            await jobRef.update({
                status: "queued",
                updatedAt: new Date().toISOString(),
            });
            console.log(`Rate limit hit for job ${jobId}. Sleeping 40s to cool down the queue...`);
            // Artificial sleep to keep the concurrency slot busy and prevent
            // the next task in the queue from immediately firing and hitting the same limit.
            await new Promise((resolve) => setTimeout(resolve, 40000));
            throw new Error("Rate limit hit, retrying...");
        }
        await jobRef.update({
            status: "error",
            error: error.message || "Unknown error during AI processing",
            updatedAt: new Date().toISOString(),
        });
    }
});
exports.dailyPriceSnapshot = (0, scheduler_1.onSchedule)({
    schedule: "0 0 * * *", // Midnight UTC daily
    timeZone: "UTC",
    region: "us-east4",
    timeoutSeconds: 300,
    memory: "256MiB",
}, async () => {
    const db = admin.firestore();
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    console.log(`[PriceSnapshot] Starting daily snapshot for ${today}`);
    const usersSnap = await db.collection("users").listDocuments();
    let totalCards = 0;
    for (const userDocRef of usersSnap) {
        const portfolioSnap = await userDocRef.collection("portfolios").get();
        const batch = db.batch();
        let batchCount = 0;
        let totalPortfolioValue = 0;
        // yesterday variable removed due to changes in 24h metrics logic
        for (const cardDoc of portfolioSnap.docs) {
            const cardData = cardDoc.data();
            const value = cardData.currentMarketValue;
            if (typeof value === "number" && value > 0) {
                totalPortfolioValue += value;
                // 1. Save history snapshot
                const historyRef = cardDoc.ref
                    .collection("priceHistory")
                    .doc(today);
                batch.set(historyRef, {
                    value,
                    timestamp: new Date().toISOString(),
                }, { merge: true });
                // 2. 24h metrics are now handled in real-time by the refresh tasks 
                // to ensure they reflect the most recent market activity compared to yesterday.
                batchCount++;
                totalCards++;
            }
        }
        // Record total portfolio value for the user
        if (totalPortfolioValue > 0) {
            const portfolioHistoryRef = userDocRef
                .collection("portfolioHistory")
                .doc(today);
            batch.set(portfolioHistoryRef, {
                totalValue: totalPortfolioValue,
                timestamp: new Date().toISOString(),
                cardCount: portfolioSnap.size
            }, { merge: true });
            batchCount++;
        }
        if (batchCount > 0) {
            await batch.commit();
        }
    }
    console.log(`[PriceSnapshot] Done. Snapshotted ${totalCards} cards for ${today}.`);
});
// --- Morning Refresh: Updates Prices From eBay ---
/**
 * Triggered at 8:00 AM EST (12:00/13:00 UTC)
 * Iterates through all cards and enqueues them for price refreshing.
 */
exports.scheduledMarketRefresh = (0, scheduler_1.onSchedule)({
    schedule: "0 8 * * *",
    timeZone: "America/New_York",
    region: "us-east4",
    memory: "512MiB",
    timeoutSeconds: 540,
}, async () => {
    const db = admin.firestore();
    // Use collectionGroup for cross-user efficiency
    const cardsSnap = await db.collectionGroup("portfolios").get();
    const queue = (0, functions_1.getFunctions)().taskQueue("locations/us-east4/functions/refreshMarketCardTask");
    console.log(`[MarketRefresh] Starting scheduled morning refresh for ${cardsSnap.size} cards...`);
    let totalEnqueued = 0;
    try {
        // Parallelize enqueuing
        const enqueuePromises = cardsSnap.docs.map(async (cardDoc) => {
            const userId = cardDoc.ref.parent.parent?.id;
            if (!userId)
                return false;
            try {
                await queue.enqueue({
                    userId: userId,
                    cardId: cardDoc.id
                }, {
                    oidcToken: {}
                });
                return true;
            }
            catch (err) {
                console.error(`[MarketRefresh] Failed to enqueue card ${cardDoc.id} for user ${userId}:`, err);
                return false;
            }
        });
        const results = await Promise.all(enqueuePromises);
        totalEnqueued = results.filter(r => r).length;
        console.log(`[MarketRefresh] Scheduled trigger complete. Enqueued ${totalEnqueued} total cards.`);
    }
    catch (globalErr) {
        console.error("[MarketRefresh] Critical failure during scheduled refresh:", globalErr);
    }
});
/**
 * Worker: Refreshes a single card's value using the Python Market Watcher Agent.
 */
exports.refreshMarketCardTask = (0, tasks_1.onTaskDispatched)({
    retryConfig: {
        maxAttempts: 3,
        minBackoffSeconds: 60,
    },
    rateLimits: {
        maxConcurrentDispatches: 10,
    },
    secrets: [EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV, AGENT_SERVICE_URL],
    region: "us-east4",
    timeoutSeconds: 300,
    memory: "512MiB",
}, async (request) => {
    const { userId, cardId } = request.data;
    const db = admin.firestore();
    const cardRef = db.doc(`users/${userId}/portfolios/${cardId}`);
    const cardSnap = await cardRef.get();
    if (!cardSnap.exists) {
        console.log(`[RefreshTask] Card ${cardId} for user ${userId} not found.`);
        return;
    }
    const cardData = cardSnap.data();
    try {
        console.log(`[RefreshTask] Calling Python Agent for ${cardData.player} (${cardId})...`);
        const agentUrl = `${AGENT_SERVICE_URL.value().trim()}/value-card`;
        console.log(`[RefreshTask] Sending card to Python Agent at: ${agentUrl}`);
        const agentResponse = await axios_1.default.post(agentUrl, {
            userId,
            cardId,
            cardDetails: {
                year: cardData.year || "",
                brand: cardData.brand || "",
                manufacturer: cardData.manufacturer || "",
                set: cardData.set || cardData.set_name || "",
                player: cardData.player || "",
                cardNumber: cardData.cardNumber || "",
                parallel: cardData.parallel || "",
                grade: cardData.grade || cardData.estimatedGrade || "",
                gradingCompany: cardData.gradingCompany || cardData.grader || ""
            }
        }, {
            headers: { "Content-Type": "application/json" },
            timeout: 180000 // 180 seconds
        });
        const result = agentResponse.data;
        if (!result || typeof result !== 'object') {
            throw new Error("Python Agent returned invalid or empty data");
        }
        let newPrice = result.final_price;
        if (typeof newPrice === "string") {
            newPrice = parseFloat(newPrice.replace(/[^0-9.]/g, ""));
        }
        if (isNaN(newPrice) || typeof newPrice !== "number") {
            newPrice = 0.99; // Default floor
        }
        // Finalize Update: Calculate 24h changes
        const timestamp = new Date().toISOString();
        const today = timestamp.split("T")[0];
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = yesterdayDate.toISOString().split("T")[0];
        // Fetch yesterday's value from priceHistory
        const yesterdaySnap = await cardRef.collection("priceHistory").doc(yesterday).get();
        let valueChange24h = 0;
        let valueChange24hPercent = 0;
        if (yesterdaySnap.exists) {
            const yesterdayValue = yesterdaySnap.data()?.value;
            if (typeof yesterdayValue === "number" && yesterdayValue > 0) {
                valueChange24h = newPrice - yesterdayValue;
                valueChange24hPercent = Math.round((valueChange24h / yesterdayValue) * 100 * 100) / 100;
            }
        }
        else if (typeof cardData.currentMarketValue === "number" && cardData.currentMarketValue > 0) {
            valueChange24h = newPrice - cardData.currentMarketValue;
            valueChange24hPercent = Math.round((valueChange24h / cardData.currentMarketValue) * 100 * 100) / 100;
        }
        // Also prepare market data for the UI
        const research = result.research_results || {};
        const marketPrices = {
            median: newPrice,
            activeItems: (research.top_listings || []).map((item) => {
                let p = item.price;
                if (typeof p === 'string')
                    p = parseFloat(p.replace(/[^0-9.]/g, ''));
                return {
                    title: String(item.title || "No Title"),
                    price: Number(p || 0),
                    url: String(item.url || "#"),
                    imageUrl: item.image_url || item.imageUrl || null
                };
            }),
            soldItems: (research.sold_listings || []).map((item) => {
                let p = item.price;
                if (typeof p === 'string')
                    p = parseFloat(p.replace(/[^0-9.]/g, ''));
                return {
                    title: String(item.title || "No Title"),
                    price: Number(p || 0),
                    url: String(item.url || "#"),
                    imageUrl: item.image_url || item.imageUrl || null,
                    endDate: String(item.endDate || item.end_date || new Date().toISOString().split('T')[0])
                };
            }),
            avgSoldPrice: research.avg_sold_price || 0,
            lowVolumeData: research.low_volume || false,
            lastUpdated: timestamp
        };
        // Atomic update of current value and audit fields
        await cardRef.update({
            currentMarketValue: newPrice,
            valueChange24h,
            valueChange24hPercent,
            lastMarketValueUpdate: timestamp,
            lastSearchQuery: result.last_search_query || null,
            valuationMethod: result.valuation_method || "Unknown",
            watcher_alert: result.alert_status || null,
            is_10_percent_diff: result.is_10_percent_diff || false,
            data_source: "GEMINI_WATCHER_AGENT_PRO",
            marketPrices
        });
        // Add to history for performance tracking
        await cardRef.collection("priceHistory").doc(today).set({
            value: newPrice,
            timestamp: timestamp,
        }, { merge: true });
        console.log(`[RefreshTask] Updated ${cardData.player} (${cardId}) to $${newPrice} using logic: ${result.valuation_method}`);
    }
    catch (error) {
        console.error(`[RefreshTask] Failed to refresh card ${cardId}:`, error);
        throw error; // Task queue will retry
    }
});
// Export new Shadow Engine v2
var marketReportV2_1 = require("./marketReportV2");
Object.defineProperty(exports, "marketReportV2", { enumerable: true, get: function () { return marketReportV2_1.marketReportV2; } });
//# sourceMappingURL=index.js.map