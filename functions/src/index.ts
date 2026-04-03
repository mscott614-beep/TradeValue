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
        scheduleDelaySeconds: 0
      }
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
        estimatedGrade: zod.string(),
        grader: zod.string().default("None"),
        estimatedMarketValue: zod.number(),
      });

      const promptText = `You are an expert trading card authenticator and grader.
Identify the card and return year, brand, player, card number, parallel, condition, grader, and estimated value.

Return a JSON object:
- year: The year the trading card was produced.
- brand: The brand (e.g., Topps, Upper Deck).
- player: The name of the player.
- cardNumber: The card number.
- parallel: The parallel or variation (e.g., "Base", "Refractor", "Silver"). 
- estimatedMarketValue: Average eBay sold price in USD.
  
  **PRECISION GUIDELINES**:
  - The 'cardNumber' MUST come from the card itself. If it is an alphanumeric code like 'DTA-TT', 'TS-NK', or 'BCP-1', return that exact code.
  - DO NOT confuse the production year (e.g. 1990) or serial numbering (e.g. 90/99) with the card number.
  - If the card features 'Autograph', 'Patch', or 'Jersey', include that in the 'features' or 'parallel' identifying fields.
  - For hockey 'Young Guns', the parallel is exactly 'Young Guns'.

${jobData.type === "image-scan" ? "Analyze the attached image(s)." : `Analyze the title: ${jobData.payload.title}`}
`;

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
      });

      const result = response.output;

      if (!result) {
        throw new Error("AI failed to generate a valid structured output.");
      }

        // --- Post-AI Enrichment: Fetch Real-Time eBay Data ---
        try {
          const EbayServiceClass = await loadEbay();
          const ebay = new EbayServiceClass(
            EBAY_CLIENT_ID.value(),
            EBAY_CLIENT_SECRET.value(),
            EBAY_ENV.value()
          );

          const { buildEbayQuery, calculateTradeValue } = await import("./ebay-pricing");

          // Search eBay using the identified metadata
          const { type, query: primaryQuery } = buildEbayQuery({
            year: result.year,
            brand: result.brand,
            set: (result as any).set,
            player: result.player,
            cardNumber: result.cardNumber,
            parallel: result.parallel,
            title: (result as any).title
          });

          const isChecklistSearch = (result.player || "").toLowerCase().includes("checklist") || 
                                    (result.brand || "").toLowerCase().includes("checklist");
          const EXCLUSIONS = ' -checklist -u-pick -upick -choice -pick -lot -choose -collection -wholesale';

          let finalQuery = primaryQuery;
          if (!isChecklistSearch && !finalQuery.includes('-checklist')) {
              finalQuery += EXCLUSIONS;
          }

          console.log(`[Enrichment] Lead Architect Query (${type}): "${finalQuery}"`);
          let ebayData = await ebay.searchActiveItems(finalQuery, 10);
          let rawItems = ebayData.itemSummaries || [];

          // 2. Soft Query Fallback (Tier 2): Player + Parallel + Number (removes Year/Brand noise)
          if (rawItems.length === 0) {
              const cleanNumber = (result.cardNumber || '').replace('#', '');
              const parallelStr = result.parallel && result.parallel.toLowerCase() !== 'base' ? result.parallel : '';
              let softQuery = `${result.player} ${parallelStr} ${cleanNumber}`.trim();
              if (!isChecklistSearch) softQuery += EXCLUSIONS;
              
              console.log(`[Enrichment] Tier 1 failed. Trying Tier 2 Soft Fallback: "${softQuery}"`);
              ebayData = await ebay.searchActiveItems(softQuery, 10);
              rawItems = ebayData.itemSummaries || [];
          }

          // 3. Softest Query Fallback (Tier 3): Player + Brand + Parallel (NO card number)
          if (rawItems.length === 0) {
              const parallelStr = result.parallel && result.parallel.toLowerCase() !== 'base' ? result.parallel : '';
              let softestQuery = `${result.player} ${result.brand} ${parallelStr}`.trim();
              if (!isChecklistSearch) softestQuery += EXCLUSIONS;

              console.log(`[Enrichment] Tier 2 failed. Trying Tier 3 Softest Fallback: "${softestQuery}"`);
              ebayData = await ebay.searchActiveItems(softestQuery, 10);
              rawItems = ebayData.itemSummaries || [];
          }

          // 4. Calculate TradeValue using the "Floor Median" Rule
          const calc = calculateTradeValue(rawItems);

          if (calc.value > 0) {
            console.log(`eBay enrichment successful. Found ${rawItems.length} items. Logic: ${calc.logic}. Price: ${calc.value}`);
            result.estimatedMarketValue = calc.value;
          } else {
            console.log(`No active eBay matches found for "${finalQuery}". Using AI estimate: ${result.estimatedMarketValue}`);
          }
      } catch (ebayError) {
        console.error("eBay enrichment failed, proceeding with AI estimate:", ebayError);
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
      const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split("T")[0];

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

          // 2. Calculate 24h change if yesterday's snapshot exists
          const yesterdaySnap = await cardDoc.ref.collection("priceHistory").doc(yesterday).get();
          if (yesterdaySnap.exists) {
            const yesterdayValue = yesterdaySnap.data()?.value;
            if (typeof yesterdayValue === "number" && yesterdayValue > 0) {
              const diff = value - yesterdayValue;
              const percent = (diff / yesterdayValue) * 100;
              
              batch.update(cardDoc.ref, {
                valueChange24h: diff,
                valueChange24hPercent: Math.round(percent * 100) / 100
              });
            }
          }

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
    const queue = getFunctions().taskQueue("refreshMarketCardTask", "us-central1");

    let totalEnqueued = 0;
    for (const userDoc of usersSnap) {
      const cardsSnap = await userDoc.collection("portfolios").listDocuments();
      for (const cardDoc of cardsSnap) {
        await queue.enqueue({
          userId: userDoc.id,
          cardId: cardDoc.id
        });
        totalEnqueued++;
      }
    }
    console.log(`[MarketRefresh] Scheduled trigger complete. Enqueued ${totalEnqueued} cards across ${usersSnap.length} users.`);
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
      const response = await ebay.searchActiveItems(searchQuery, 10);
      const items = response.itemSummaries || [];
      const calc = calculateTradeValue(items);

      if (calc.value > 0) {
        const timestamp = new Date().toISOString();
        const today = timestamp.split("T")[0];

        // Atomic update of current value
        await cardRef.update({
          currentMarketValue: calc.value,
          lastChecked: timestamp,
          updatedAt: timestamp
        });

        // Add to history for performance tracking
        await cardRef.collection("priceHistory").doc(today).set({
          value: calc.value,
          timestamp: timestamp,
        }, { merge: true });

        console.log(`[RefreshTask] Successfully updated ${card.title} (${cardId}) to $${calc.value}`);
      } else {
        console.log(`[RefreshTask] No market matches found for ${card.title}. Keeping existing value.`);
      }
    } catch (error: any) {
      console.error(`[RefreshTask] Failed to refresh card ${cardId}:`, error);
      throw error; // Task queue will retry based on config
    }
  }
);
