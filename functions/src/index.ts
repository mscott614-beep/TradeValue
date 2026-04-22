import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFunctions } from "firebase-admin/functions";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
// Lazy load heavy dependencies to avoid 10s initialization timeout
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

const GOOGLE_GENAI_API_KEY = defineSecret("GOOGLE_GENAI_API_KEY");
const EBAY_CLIENT_ID = defineSecret("EBAY_CLIENT_ID");
const EBAY_CLIENT_SECRET = defineSecret("EBAY_CLIENT_SECRET");
const EBAY_ENV = defineSecret("EBAY_ENV");

admin.initializeApp();

const GENERIC_SET_STOPWORDS = [
  'base set', 'base', 'hockey', 'nhl', 'nfl', 'nba', 'mlb', 'mls', 'standard',
  'regular', 'common', 'standard issue', 'insert'
];

// Producer: Triggered when a new job is created in 'scanJobs'
export const enqueueGeminiTask = onDocumentCreated("scanJobs/{jobId}", async (event) => {
  const jobId = event.params.jobId;
  const jobData = event.data?.data();

  if (!jobData || jobData.status !== "pending") {
    console.log(`Job ${jobId} is not pending or missing data. Status: ${jobData?.status}`);
    return;
  }

  const queue = getFunctions().taskQueue("locations/us-central1/functions/geminiProcessingQueue");

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
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 30,
    },
    rateLimits: {
      maxConcurrentDispatches: 1,
      maxDispatchesPerSecond: 1,
    },
    secrets: [GOOGLE_GENAI_API_KEY, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV],
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

      const { genkit: genkitFunc, googleAI: googleAIFunc, z: zod } = await loadGenkit();
      const ai = genkitFunc({
        plugins: [googleAIFunc({ apiKey: GOOGLE_GENAI_API_KEY.value() })],
        model: "googleai/gemini-3.1-flash-lite-preview",
      });

      // Define Output Schema
      const ScanOutputSchema = zod.object({
        year: zod.string(),
        brand: zod.string(),
        player: zod.string(),
        cardNumber: zod.string(),
        parallel: zod.string().default("Base"),
        grade: zod.string().nullable(),
        grader: zod.string().nullable(),
      });

      const promptText = `You are an expert trading card authenticator. 
Analyze the card and return year, brand, player, card number, parallel, and grading info.

Look at the top of the card holder. If there is a professional grading label (PSA, BGS, SGC, CGC), identify the company (grader) and the numerical grade. If no label is present, set both to null.

Return a JSON object:
- year: The year of the card.
- brand: The brand (e.g., Topps, Upper Deck).
- player: The name of the player.
- cardNumber: The card number (exactly as it appears).
- parallel: The variation or parallel (e.g., "Silver Prizm", "Base", "/99").
- grade: The numerical grade (e.g., "10", "9.5") or null.
- grader: The grading company (e.g., "PSA", "BGS") or null.`;

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
        config: {
          temperature: 0.1,
          maxOutputTokens: 1024,
        }
      });

      const result = response.output;

      if (!result) {
        throw new Error("AI failed to generate a valid structured output.");
      }

        // --- Post-AI Enrichment: Fetch Real-Time eBay Data (Massapequa Hammer) ---
        try {
          const EbayServiceClass = await loadEbay();
          const ebay = new EbayServiceClass(
            EBAY_CLIENT_ID.value(),
            EBAY_CLIENT_SECRET.value(),
            EBAY_ENV.value()
          );

          // Brand Alias Mapping
          const brandAlias: Record<string, string> = {
            "In The Game": "ITG",
            "Upper Deck": "UD",
            "Topps": "Chrome" // Common for many sets
          };

          const sanitizeQuery = (metadata: any) => {
            const values = [
              metadata.year,
              brandAlias[metadata.brand] || metadata.brand,
              metadata.player,
              (metadata.cardNumber || "").replace("#", ""),
              metadata.parallel !== "Base" ? metadata.parallel : null,
              metadata.grade ? `${metadata.grader || ""} ${metadata.grade}` : null
            ];
            
            return values
              .filter(v => v && v !== "null" && v !== "undefined" && v !== "Base Set")
              .join(" ")
              .replace(/null/gi, "")
              .replace(/undefined/gi, "")
              .replace(/\s+/g, " ")
              .trim();
          };

          // Tier 1 (Precision)
          const tier1Query = sanitizeQuery(result);
          console.log(`[Tier 1] Precision Query: "${tier1Query}"`);
          
          let ebayData = await ebay.searchActiveItems(tier1Query, 10);
          let rawItems = ebayData.itemSummaries || [];

          // Tier 2 (The Collector)
          if (rawItems.length === 0) {
            const alias = brandAlias[result.brand] || result.brand;
            const tier2Query = `${alias} ${result.player} ${(result.cardNumber || "").replace("#", "")}`.trim();
            console.log(`[Tier 2] Collector Query: "${tier2Query}"`);
            ebayData = await ebay.searchActiveItems(tier2Query, 10);
            rawItems = ebayData.itemSummaries || [];
          }

          // Tier 3 (The Rookie)
          if (rawItems.length === 0 && (result.year === "2015" || result.year === "2016" || result.year.includes("2015"))) {
            const tier3Query = `${result.player} ${(result.cardNumber || "").replace("#", "")} RC`.trim();
            console.log(`[Tier 3] Rookie Query: "${tier3Query}"`);
            ebayData = await ebay.searchActiveItems(tier3Query, 10);
            rawItems = ebayData.itemSummaries || [];
          }

          // Tier 4 (The Hammer)
          if (rawItems.length === 0) {
            const tier4Query = `${result.player} ${(result.cardNumber || "").replace("#", "")}`.trim();
            console.log(`[Tier 4] Hammer Query: "${tier4Query}"`);
            ebayData = await ebay.searchActiveItems(tier4Query, 10);
            rawItems = ebayData.itemSummaries || [];
          }

          // Calculate Valuation (Price + Shipping Average)
          if (rawItems.length > 0) {
            let totalVal = 0;
            let count = 0;
            rawItems.forEach((item: any) => {
              const price = parseFloat(item.price?.value || "0");
              const shipping = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || "0");
              if (price > 0) {
                totalVal += (price + shipping);
                count++;
              }
            });
            
            const averageValue = count > 0 ? Math.round((totalVal / count) * 100) / 100 : 0;
            (result as any).estimatedMarketValue = averageValue;
            console.log(`eBay enrichment successful. Avg Price+Shipping: ${averageValue} across ${count} items.`);
          } else {
            console.log(`FINAL ATTEMPT STRING: [FAIL] No results found for any tier.`);
            (result as any).estimatedMarketValue = 0;
          }
        } catch (ebayError) {
          console.error("eBay enrichment failed:", ebayError);
          (result as any).estimatedMarketValue = 0;
        }
      // --- End Enrichment ---

      await jobRef.update({
        status: "completed",
        result,
        updatedAt: new Date().toISOString(),
      });

      console.log(`Job ${jobId} completed successfully`);

      // Artificially sleep for 6.5 seconds to pace the queue.
      // With maxConcurrentDispatches: 1, this guarantees we stay well below 
      // the Gemini 2.5 Flash Free Tier limit of 15 Requests Per Minute (RPM)
      // (Total execution time ~8 seconds per card = ~7.5 RPM)
      await new Promise((resolve) => setTimeout(resolve, 6500));

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

      await jobRef.update({
        status: "error",
        error: error.message || "Unknown error during AI processing",
        updatedAt: new Date().toISOString(),
      });
    }
  }
);


export const dailyPriceSnapshot = onSchedule(
  {
    schedule: "0 0 * * *", // Midnight UTC daily
    timeZone: "UTC",
    region: "us-central1",
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
    region: "us-central1",
  },
  async () => {
    const db = admin.firestore();
    const usersSnap = await db.collection("users").listDocuments();
    const queue = getFunctions().taskQueue("locations/us-central1/functions/refreshMarketCardTask");

    console.log("[MarketRefresh] Starting scheduled morning refresh...");
    let totalEnqueued = 0;
    let userCount = 0;

    try {
      for (const userDoc of usersSnap) {
        userCount++;
        const cardsSnap = await userDoc.collection("portfolios").listDocuments();
        console.log(`[MarketRefresh] Processing user ${userDoc.id} (${cardsSnap.length} cards)`);

        // Parallelize enqueuing within each user's portfolio
        const enqueuePromises = cardsSnap.map(async (cardDoc) => {
          try {
            await queue.enqueue(
              {
                userId: userDoc.id,
                cardId: cardDoc.id
              },
              {
                oidcToken: {}
              } as any
            );
            return true;
          } catch (err) {
            console.error(`[MarketRefresh] Failed to enqueue card ${cardDoc.id} for user ${userDoc.id}:`, err);
            return false;
          }
        });

        const results = await Promise.all(enqueuePromises);
        totalEnqueued += results.filter(r => r).length;
      }
      console.log(`[MarketRefresh] Scheduled trigger complete. Enqueued ${totalEnqueued} total cards across ${userCount} users.`);
    } catch (globalErr) {
      console.error("[MarketRefresh] Critical failure during scheduled refresh:", globalErr);
    }
  }
);

/**
 * Worker: Refreshes a single card's value from eBay.
 * Using Task Queue to manage rate limits and long execution times for large portfolios.
 */
export const refreshMarketCardTask = onTaskDispatched(
  {
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: 5,
    },
    secrets: [EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV],
    region: "us-central1",
    timeoutSeconds: 300,
  },
  async (request) => {
    const { userId, cardId } = request.data as { userId: string, cardId: string };
    const db = admin.firestore();
    const cardRef = db.doc(`users/${userId}/portfolios/${cardId}`);
    const cardSnap = await cardRef.get();

    if (!cardSnap.exists) {
      console.log(`[RefreshTask] Card ${cardId} for user ${userId} not found.`);
      return;
    }
    const card = cardSnap.data()!;

    try {
      const EbayServiceClass = await loadEbay();
      const ebay = new EbayServiceClass(
        EBAY_CLIENT_ID.value(),
        EBAY_CLIENT_SECRET.value(),
        EBAY_ENV.value()
      );

      const { buildEbayQuery, calculateTradeValue } = await import("./ebay-pricing");

      // Construct precise query for this card
      const { query: searchQuery } = buildEbayQuery({
        year: card.year,
        brand: card.brand,
        set: card.set,
        player: card.player,
        cardNumber: card.cardNumber,
        parallel: card.parallel,
        title: card.title
      });

      // Fetch active listings
      let usedQuery = searchQuery;
      let response = await ebay.searchActiveItems(searchQuery, 10);
      let items = response.itemSummaries || [];

      // Stage 2 (Variant-First): Prioritize Variant / Parallel but DROP the brittle card number.
      if (items.length === 0 && (card.parallel || card.set)) {
        const set = card.set && !GENERIC_SET_STOPWORDS.includes(card.set.toLowerCase()) ? card.set : "";
        const variantQuery = `${card.year} ${card.brand} ${set} ${card.player} ${card.parallel || ""} -reprint -digital`.replace(/\s+/g, " ").trim();

        console.log(`[RefreshTask] Stage 1 failed. Trying Stage 2 (Variant-First): "${variantQuery}"`);
        usedQuery = variantQuery;
        response = await ebay.searchActiveItems(variantQuery, 10);
        items = response.itemSummaries || [];
      }

      // Stage 3 (Identifier-First): Try the Card Number but DROP the Parallel/Set.
      if (items.length === 0) {
        const cleanNum = (card.cardNumber || "").toString().replace("#", "").trim();
        const formattedNum = cleanNum.match(/^\d+$/) ? `#${cleanNum}` : cleanNum;
        const identifierQuery = `${card.year} ${card.brand} ${card.player} ${formattedNum} -reprint -digital`.replace(/\s+/g, " ").trim();

        console.log(`[RefreshTask] Stage 2 failed. Trying Stage 3 (Identifier-First): "${identifierQuery}"`);
        usedQuery = identifierQuery;
        response = await ebay.searchActiveItems(identifierQuery, 10);
        items = response.itemSummaries || [];
      }

      // Stage 4 (Nuclear Fallback): Inject critical keywords (Auto, Patch, Jersey, Rookie).
      if (items.length === 0) {
        const featureStr = [
          card.parallel || "",
          ...(card.features || []),
          card.title || "",
          card.set || "",
        ].join(" ").toLowerCase();

        let keywords = "";
        if (featureStr.includes("auto") || featureStr.includes("signature")) keywords += " auto";
        if (featureStr.includes("patch") || featureStr.includes("threads")) keywords += " patch";
        if (featureStr.includes("jersey") || featureStr.includes("relic") || featureStr.includes("memo")) keywords += " jersey";
        if (featureStr.includes("rookie") || featureStr.includes("debut")) keywords += " rookie";

        const nuclearQuery = `${card.year} ${card.brand} ${card.set || ""} ${card.player}${keywords} -reprint -digital`.replace(/\s+/g, " ").trim();

        console.log(`[RefreshTask] Stage 3 failed. Trying Stage 4 (Nuclear): "${nuclearQuery}"`);
        usedQuery = nuclearQuery;
        response = await ebay.searchActiveItems(nuclearQuery, 10);
        items = response.itemSummaries || [];
      }

      const calc = calculateTradeValue(items);

      if (calc.value > 0) {
        // 5. Finalize Update: Calculate 24h changes
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
            valueChange24h = calc.value - yesterdayValue;
            valueChange24hPercent = Math.round((valueChange24h / yesterdayValue) * 100 * 100) / 100;
          }
        } else if (typeof card.currentMarketValue === "number" && card.currentMarketValue > 0) {
          // Fallback: If no yesterday's snapshot, compare with currentMarketValue
          // This is useful for the first time the sync runs or if a previous sync succeeded but no snapshot was saved
          valueChange24h = calc.value - card.currentMarketValue;
          valueChange24hPercent = Math.round((valueChange24h / card.currentMarketValue) * 100 * 100) / 100;
        }

        // Atomic update of current value and 24h change metrics
        await cardRef.update({
          currentMarketValue: calc.value,
          valueChange24h,
          valueChange24hPercent,
          lastChecked: timestamp,
          updatedAt: timestamp
        });

        // Add to history for performance tracking
        await cardRef.collection("priceHistory").doc(today).set({
          value: calc.value,
          timestamp: timestamp,
        }, { merge: true });

        console.log(`[RefreshTask] Successfully updated ${card.title} (${cardId}) to $${calc.value} using: ${usedQuery}`);
      } else {
        console.log(`[RefreshTask] No market matches found for ${card.title}. Keeping existing value.`);
      }
    } catch (error: any) {
      console.error(`[RefreshTask] Failed to refresh card ${cardId}:`, error);
      throw error; // Task queue will retry based on config
    }
  }
);
