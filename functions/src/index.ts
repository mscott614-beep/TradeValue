import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFunctions } from "firebase-admin/functions";
import * as admin from "firebase-admin";
import axios from "axios";
import { defineSecret } from "firebase-functions/params";
import { onObjectFinalized } from "firebase-functions/v2/storage";
// Lazy load heavy dependencies to avoid 10s initialization timeout

let genkit: any;
let vertexAI: any;
let z: any;



async function loadGenkit() {
  if (!genkit) {
    const genkitMod = await import("genkit");
    const aiMod = await import("@genkit-ai/googleai");
    genkit = genkitMod.genkit;
    z = genkitMod.z;
    vertexAI = aiMod.googleAI;
  }
  return { genkit, z, googleAI: vertexAI };
}

const PRIMARY_MODEL = 'googleai/gemini-3.5-flash';
const FALLBACK_MODEL = 'googleai/gemini-2.5-flash';

const GOOGLE_GENAI_API_KEY = defineSecret("GOOGLE_GENAI_API_KEY");
const EBAY_CLIENT_ID = defineSecret("EBAY_CLIENT_ID");
const EBAY_CLIENT_SECRET = defineSecret("EBAY_CLIENT_SECRET");
const EBAY_ENV = defineSecret("EBAY_ENV");
const AGENT_SERVICE_URL = defineSecret("AGENT_SERVICE_URL");

admin.initializeApp();
admin.firestore().settings({ ignoreUndefinedProperties: true });

// Producer: Triggered when a new job is created in 'scanJobs'
export const enqueueGeminiTask = onDocumentCreated({
  document: "scanJobs/{jobId}",
  region: "us-east4"
}, async (event) => {
  const jobId = event.params.jobId;
  const jobData = event.data?.data();

  if (!jobData || jobData.status !== "pending") {
    console.log(`Job ${jobId} is not pending or missing data. Status: ${jobData?.status}`);
    return;
  }

  const queue = getFunctions().taskQueue("locations/us-east4/functions/geminiProcessingQueue");

  try {
    await queue.enqueue(
      { jobId },
      {
        scheduleDelaySeconds: 0,
        oidcToken: {},
      } as any
    );

    await event.data?.ref.update({
      status: "queued",
      updatedAt: new Date().toISOString(),
    });

    console.log(`Successfully enqueued job ${jobId} to geminiProcessingQueue`);
  } catch (error) {
    console.error(`Failed to enqueue job ${jobId}:`, error);
    await event.data?.ref.update({
      status: "error",
      error: "Failed to enqueue task",
      updatedAt: new Date().toISOString(),
    });
  }
});

// Worker: Consumes the task and calls Gemini
export const geminiProcessingQueue = onTaskDispatched(
  {
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
  },
  async (request) => {
    const { jobId } = request.data as { jobId: string };
    console.log(`Worker processing job ${jobId}`);
    const db = admin.firestore();
    const jobRef = db.collection("scanJobs").doc(jobId);
    const jobSnap = await jobRef.get();

    if (!jobSnap.exists) {
      console.error(`Job ${jobId} not found`);
      return;
    }

    const jobData = jobSnap.data()!;
    if (jobData.status === "completed") {
      console.log(`Job ${jobId} already completed`);
      return;
    }

    try {
      await jobRef.update({
        status: "processing",
        updatedAt: new Date().toISOString(),
      });

      const { genkit, googleAI } = await loadGenkit();

      const ai = genkit({
        plugins: [googleAI({ apiKey: GOOGLE_GENAI_API_KEY.value() })],
      });

      const { identifyCardFromImages, ScanOutputSchema } = await import("./scan-identify");

      let result: any;

      if (jobData.type === "image-scan") {
        console.log(`[Scanner] Two-pass OCR identification (${PRIMARY_MODEL})`);
        result = await identifyCardFromImages(
          ai,
          {
            frontPhotoDataUri: jobData.payload.frontPhotoDataUri,
            backPhotoDataUri: jobData.payload.backPhotoDataUri,
          },
          PRIMARY_MODEL,
          FALLBACK_MODEL
        );
      } else if (jobData.type === "text-parse") {
        const promptText = `Parse this card title into structured metadata: ${jobData.payload.title}`;
        let response;
        try {
          response = await ai.generate({
            model: PRIMARY_MODEL,
            prompt: [{ text: promptText }],
            output: { schema: ScanOutputSchema },
            config: { temperature: 0, maxOutputTokens: 1024 },
          });
        } catch (err: any) {
          response = await ai.generate({
            model: FALLBACK_MODEL,
            prompt: [{ text: promptText }],
            output: { schema: ScanOutputSchema },
            config: { temperature: 0, maxOutputTokens: 1024 },
          });
        }
        result = response.output;
      }

      if (!result) {
        throw new Error("AI failed to generate a valid structured output.");
      }

      // --- Post-AI Enrichment: Call Python Agent for Instant Pricing ---
      try {
        console.log(`[Scanner] Calling Python Agent for real-time pricing: ${result.player}...`);
        
        const agentUrl = `${AGENT_SERVICE_URL.value().trim()}/value-card`;
        const agentResponse = await axios.post(agentUrl, {
          userId: jobData.userId,
          cardId: jobData.type === "text-parse" ? "CSV_IMPORT" : "SCAN_PREVIEW",
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
        (result as any).estimatedMarketValue = agentData.final_price || 0.99;
        
        // Fix year display if expanded by agent
        if (agentData.last_search_query) {
          const yearMatch = agentData.last_search_query.match(/^\d{4}-\d{2}/);
          if (yearMatch && result.year.length === 4) {
            result.year = yearMatch[0];
          }
        }

        (result as any).estimatedGrade = result.grade || result.conditionAssessment || "Raw";
        (result as any).valuationMethod = agentData.valuation_method;
        (result as any).lastSearchQuery = agentData.last_search_query;
        (result as any).marketPrices = agentData.marketPrices || {
          median: agentData.final_price || 0.99,
          activeItems: agentData.active_listings || [],
          soldItems: agentData.sold_listings || []
        };

      } catch (agentErr: any) {
        console.error(`[Scanner] Agent pricing failed: ${agentErr.message}`);
        try {
          const { EbayService } = await import("./ebay");
          const ebay = new EbayService(
            EBAY_CLIENT_ID.value(),
            EBAY_CLIENT_SECRET.value(),
            EBAY_ENV.value()
          );
          const graderLabel =
            result.grader && result.grader !== "None" ? `${result.grader} ${result.grade || ""}` : "";
          const conditionStr = graderLabel
            ? graderLabel.trim()
            : "Raw -PSA -BGS -SGC -CGC -GMA -Graded -Slab";
          const query = `${result.year} ${result.brand} ${result.set || ""} ${result.player} ${result.cardNumber} ${conditionStr}`
            .replace(/\s+/g, " ")
            .trim();
          console.log(`[Scanner] eBay fallback search: "${query}"`);
          const ebayResults = await ebay.searchActiveItems(query, 10, "price", true);
          const prices = (ebayResults.itemSummaries || [])
            .map((item) => parseFloat(item.price?.value || "0"))
            .filter((p) => !isNaN(p) && p > 0)
            .sort((a, b) => a - b);
          if (prices.length > 0) {
            const mid = Math.floor(prices.length / 2);
            const median =
              prices.length % 2 !== 0
                ? prices[mid]
                : (prices[mid - 1] + prices[mid]) / 2;
            (result as any).estimatedMarketValue = parseFloat(median.toFixed(2));
            (result as any).valuationMethod = "ebay_sold_median_fallback";
            (result as any).lastSearchQuery = query;
          } else {
            (result as any).estimatedMarketValue = 0.99;
            (result as any).valuationMethod = "fallback_unpriced";
          }
        } catch (ebayErr: any) {
          console.error(`[Scanner] eBay fallback failed: ${ebayErr.message}`);
          (result as any).estimatedMarketValue = 0.99;
          (result as any).valuationMethod = "fallback_unpriced";
        }
        (result as any).estimatedGrade = result.grade || result.conditionAssessment || "Raw";
      }

      if (result.grader == null) {
        (result as any).grader = "None";
      }
      if (!(result as any).estimatedMarketValue) {
        (result as any).estimatedMarketValue = 0.99;
      }

      await jobRef.update({
        status: "completed",
        result,
        updatedAt: new Date().toISOString(),
      });

      console.log(`Job ${jobId} completed successfully`);

    } catch (error: any) {
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

      const rawMessage = error.message || "Unknown error during AI processing";
      let userMessage = rawMessage;
      if (rawMessage.includes("prepayment credits are depleted")) {
        userMessage =
          "Gemini API billing credits are depleted. Restore billing in Google AI Studio, then scan again.";
      } else if (rawMessage.includes("429") || rawMessage.includes("Quota")) {
        userMessage = "AI quota limit reached. Please wait a minute and try again.";
      } else if (rawMessage.includes("404") && rawMessage.includes("models/")) {
        userMessage =
          "Scanner model configuration error. A deploy fix is in progress — please retry in a few minutes.";
      }

      await jobRef.update({
        status: "error",
        error: userMessage,
        updatedAt: new Date().toISOString(),
      });
    }
  }
);


export const dailyPriceSnapshot = onSchedule(
  {
    schedule: "0 0 * * *", // Midnight UTC daily
    timeZone: "UTC",
    region: "us-east4",
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
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
  }
);

// --- Morning Refresh: Updates Prices From eBay ---



/**
 * Triggered at 8:00 AM EST (12:00/13:00 UTC)
 * Iterates through all cards and enqueues them for price refreshing.
 */
export const scheduledMarketRefresh = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "America/New_York",
    region: "us-east4",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    try {
      const db = admin.firestore();
      const queue = getFunctions().taskQueue("locations/us-east4/functions/refreshMarketCardTask");

      console.log("[MarketRefresh] Starting prioritized morning refresh...");

      // Pass A: Cards with 0, null, or missing currentMarketValue
      const snapA0 = await db.collectionGroup("portfolios").where("currentMarketValue", "==", 0).get();
      const snapAnull = await db.collectionGroup("portfolios").where("currentMarketValue", "==", null).get();
      
      // Combine Pass A IDs to avoid duplicates
      const passAIds = new Set<string>();
      const passATasks: any[] = [];
      
      [snapA0, snapAnull].forEach(snap => {
        snap.docs.forEach(doc => {
          const userId = doc.ref.parent.parent?.id;
          if (userId && !passAIds.has(doc.id)) {
            passAIds.add(doc.id);
            passATasks.push({ userId, cardId: doc.id, deepSearch: true });
          }
        });
      });

      // Pass B: Everything else
      const allSnap = await db.collectionGroup("portfolios").get();
      const passBTasks: any[] = [];
      allSnap.docs.forEach(doc => {
        if (!passAIds.has(doc.id)) {
          const userId = doc.ref.parent.parent?.id;
          if (userId) {
            passBTasks.push({ userId, cardId: doc.id, deepSearch: false });
          }
        }
      });

      console.log(`[MarketRefresh] Pass A (N/A Priority): ${passATasks.length} cards.`);
      console.log(`[MarketRefresh] Pass B (Standard): ${passBTasks.length} cards.`);

      // Prioritize Pass A
      const finalQueue = [...passATasks, ...passBTasks];
      let totalEnqueued = 0;

      const enqueuePromises = finalQueue.map(async (task) => {
        try {
          await queue.enqueue(task, { oidcToken: {} } as any);
          return true;
        } catch (err) {
          console.error(`[MarketRefresh] Failed to enqueue card ${task.cardId}:`, err);
          return false;
        }
      });

      const results = await Promise.all(enqueuePromises);
      totalEnqueued = results.filter(r => r).length;
      console.log(`[MarketRefresh] Scheduled trigger complete. Enqueued ${totalEnqueued} total cards.`);
    } catch (globalErr) {
      console.error("[MarketRefresh] Critical failure during scheduled refresh:", globalErr);
    }
  }
);

/**
 * Worker: Refreshes a single card's value using the Python Market Watcher Agent.
 */
export const refreshMarketCardTask = onTaskDispatched(
  {
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: 10,
    },
    secrets: [EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV, AGENT_SERVICE_URL],
    region: "us-east4",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (request) => {
    const { logger } = await import("firebase-functions");
    const { userId, cardId, deepSearch } = request.data as { userId: string, cardId: string, deepSearch?: boolean };
    
    logger.info('SYNC_START', { cardId, userId });

    if (admin.apps.length === 0) {
      admin.initializeApp();
      admin.firestore().settings({ ignoreUndefinedProperties: true });
    }
    const db = admin.firestore();
    const cardRef = db.doc(`users/${userId}/portfolios/${cardId}`);
    const cardSnap = await cardRef.get();

    if (!cardSnap.exists) {
      console.log(`[RefreshTask] Card ${cardId} for user ${userId} not found.`);
      return;
    }
    const cardData = cardSnap.data()!;
    console.log(`[RefreshTask] Triggered for ${cardData.player} (${cardId}) [DeepSearch: ${!!deepSearch}]`);

    try {
      const agentUrl = `${AGENT_SERVICE_URL.value().trim()}/value-card`;
      console.log(`[RefreshTask] Sending card to Python Agent at: ${agentUrl}`);
      
      const agentResponse = await axios.post(agentUrl, {
        userId,
        cardId,
        deepSearch: !!deepSearch,
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
        timeout: 540000 // 540 seconds (9 minutes)
      });

      const result = agentResponse.data as any;
      if (!result || typeof result !== 'object') {
        throw new Error("Python Agent returned invalid or empty data");
      }
      
      let newPrice = result.final_price;
      if (newPrice === undefined || newPrice === null) {
        newPrice = cardData.currentMarketValue || 0.01;
      }

      if (typeof newPrice === "string") {
        newPrice = parseFloat(newPrice.replace(/[^0-9.]/g, ""));
      }

      if (isNaN(newPrice) || typeof newPrice !== "number") {
        newPrice = cardData.currentMarketValue || 0.99; // Default floor
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
      } else if (typeof cardData.currentMarketValue === "number" && cardData.currentMarketValue > 0) {
        valueChange24h = newPrice - cardData.currentMarketValue;
        valueChange24hPercent = Math.round((valueChange24h / cardData.currentMarketValue) * 100 * 100) / 100;
      }

      // Also prepare market data for the UI
      const activeListings = result.marketPrices?.activeItems || result.active_listings || [];
      const soldListings = result.marketPrices?.soldItems || result.sold_listings || [];
      const avgSoldPrice = result.marketPrices?.avgSoldPrice || result.avg_sold_price || 0;
      const lowVolumeData = result.marketPrices?.lowVolumeData || result.lowVolumeData || false;

      const marketPrices = {
        median: newPrice,
        activeItems: activeListings.map((item: any) => {
          let p = item.price;
          if (typeof p === 'string') p = parseFloat(p.replace(/[^0-9.]/g, ''));
          return {
            title: String(item.title || "No Title"),
            price: Number(p || 0),
            url: String(item.url || item.itemWebUrl || "#"),
            imageUrl: item.image_url || item.imageUrl || null
          };
        }),
        soldItems: soldListings.map((item: any) => {
          let p = item.price;
          if (typeof p === 'string') p = parseFloat(p.replace(/[^0-9.]/g, ''));
          return {
            title: String(item.title || "No Title"),
            price: Number(p || 0),
            url: String(item.url || item.itemWebUrl || "#"),
            imageUrl: item.image_url || item.imageUrl || null,
            endDate: String(item.endDate || item.end_date || new Date().toISOString().split('T')[0])
          };
        }),
        avgSoldPrice: avgSoldPrice || 0,
        lowVolumeData: lowVolumeData || false,
        lastUpdated: timestamp
      };

      // --- STICKY VALUATION & PRICE GUARD ---
      let finalUpdatePrice = newPrice;
      let finalStatus = result.status || (newPrice === 0.01 ? 'manual_review' : 'verified');

      const existingPrice = cardData.currentMarketValue || 0;
      const existingStatus = cardData.status || 'unverified';

      // 1. Sticky Valuation: If no new data found (0.01) but we have a verified anchor, do NOT overwrite.
      if (newPrice <= 0.01 && existingPrice > 0.01 && existingStatus === 'verified') {
        finalUpdatePrice = existingPrice;
        finalStatus = 'verified';
        console.log(`[RefreshTask] Sticky Valuation: Keeping verified anchor $${existingPrice} for ${cardId}`);
      }

      // 2. Product Line Guard: If box set (CM/M) vs flagship jump is > 500%, block and flag.
      const isBoxSet = cardData.cardNumber?.includes('CM') || cardData.cardNumber?.includes('M');
      if (isBoxSet && existingPrice > 0 && newPrice > existingPrice * 6.0) {
        finalUpdatePrice = existingPrice;
        finalStatus = 'manual_review';
        console.log(`[RefreshTask] Price Guard: Blocked suspicious jump for box set card ${cardId}`);
      }

      // Atomic update of current value and audit fields
      await cardRef.update({
        currentMarketValue: finalUpdatePrice,
        valueChange24h,
        valueChange24hPercent,
        lastMarketValueUpdate: timestamp,
        lastSearchQuery: result.last_search_query || null,
        valuationMethod: result.valuation_method || "Unknown",
        watcher_alert: result.alert_status || null,
        is_10_percent_diff: result.is_10_percent_diff || false,
        data_source: "GEMINI_WATCHER_AGENT_PRO",
        marketPrices,
        status: finalStatus,
        debug_info: {
          lastSearchQuery: result.last_search_query || "",
          search_snippets: result.debug_snippets || []
        },
        supporting_data: result.supporting_evidence || result.supporting_data || {}
      });

      // Add to history for performance tracking
      await cardRef.collection("priceHistory").doc(today).set({
        value: newPrice,
        timestamp: timestamp,
      }, { merge: true });

      console.log(`[RefreshTask] Updated ${cardData.player} (${cardId}) to $${newPrice} using logic: ${result.valuation_method}`);
    } catch (error: any) {
      console.error(`[RefreshTask] Failed to refresh card ${cardId}:`, error);
      throw error; // Task queue will retry
    }
  }
);
// Export new Shadow Engine v2
export { marketReportV2 } from "./marketReportV2";
// Global Batch Sync Scheduler (6:00 AM)
export const globalBatchSync = onSchedule({
  schedule: "0 6 * * *",
  region: "us-east4",
  secrets: [AGENT_SERVICE_URL]
}, async (event) => {
  const agentUrl = `${AGENT_SERVICE_URL.value().trim()}/batch-sync`;
  try {
    await axios.post(agentUrl, { userId: "GLOBAL_BATCH_SYSTEM" });
    console.log("[GlobalSync] Triggered Vertex AI Batch Prediction Job at 6:00 AM");
  } catch (error) {
    console.error("[GlobalSync] Failed to trigger batch job:", error);
  }
});

// Batch Ingestion: Triggers when Vertex AI finishes writing output to GCS
export const ingestBatchResults = onObjectFinalized({
  bucket: `${process.env.GCLOUD_PROJECT}-batch-sync`,
  region: "us-central1"
}, async (event) => {
  // Vertex AI writes results in nested folders, we look for JSONL files
  if (!event.data.name.includes("/output/") || !event.data.name.endsWith(".jsonl")) return;

  const storage = admin.storage();
  const bucket = storage.bucket(event.data.bucket);
  const file = bucket.file(event.data.name);
  const [content] = await file.download();
  
  const lines = content.toString().split("\n").filter(l => l.trim());
  const db = admin.firestore();

  for (const line of lines) {
    try {
      const result = JSON.parse(line);
      const metadata = result.metadata;
      const response = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!metadata || !response) continue;

      let resJson: any;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        resJson = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch (e) {
        console.error(`[Ingestion] Malformed JSON in batch response for ${metadata.cardId}`);
        continue;
      }

      if (!resJson) continue;

      const cardRef = db.doc(metadata.path);
      const newPrice = parseFloat(resJson.final_price) || 0.01;
      const existingPrice = metadata.existingPrice || 0;
      const existingStatus = metadata.existingStatus || 'unverified';

      // Apply Sticky Valuation & Guard Logic
      let finalPrice = newPrice;
      let finalStatus = resJson.status || (newPrice === 0.01 ? 'manual_review' : 'verified');

      if (newPrice <= 0.01 && existingPrice > 0.01 && existingStatus === 'verified') {
        finalPrice = existingPrice;
        finalStatus = 'verified';
      }

      await cardRef.update({
        currentMarketValue: finalPrice,
        status: finalStatus,
        lastMarketValueUpdate: new Date().toISOString(),
        valuationMethod: "VERTEX_BATCH_FLASH_LITE",
        supporting_data: resJson.supporting_evidence || resJson.supporting_data || {}
      });

      // --- BINDER SYNC (COLLECTIONS PATH) ---
      const cardId = metadata.cardId;
      if (cardId) {
        await db.collection("collections").doc(cardId).update({
          currentMarketValue: finalPrice,
          status: finalStatus,
          lastMarketValueUpdate: new Date().toISOString(),
          valuationMethod: "VERTEX_BATCH_FLASH_LITE_SYNC",
          supporting_data: resJson.supporting_evidence || resJson.supporting_data || {}
        });
      }

    } catch (error) {
      console.error("[Ingestion] Error processing line:", error);
    }
  }
  
  console.log(`[Ingestion] Finished processing batch result file: ${event.data.name}`);
});
