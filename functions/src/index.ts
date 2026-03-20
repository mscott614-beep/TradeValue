import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
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
  IMPORTANT: For hockey cards, "Young Guns" and "Young Guns Canvas" MUST be identified as the parallel.
- estimatedGrade: The condition (e.g., Mint, 9, 10).
- grader: "PSA", "BGS", etc. or "None".
- estimatedMarketValue: Average eBay sold price in USD.

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

        // Search eBay using the identified metadata including condition
        let conditionStr = "";
        if (result.grader !== "None") {
          conditionStr = `${result.grader} ${result.estimatedGrade}`;
        } else {
          // EXCLUSION: For raw cards, explicitly exclude graded terms to prevent price inflation
          conditionStr = "Raw -PSA -BGS -SGC -CGC -GMA -Graded -Slab -Auth";
        }
        
        const searchQuery = `${result.year} ${result.brand} ${result.player} ${result.cardNumber || ""} ${result.parallel || ""} ${conditionStr}`.trim();
        console.log(`Enriching result with eBay data for query: "${searchQuery}"`);
        
        const ebayData = await ebay.searchActiveAuctions(searchQuery, 10);
        
        if (ebayData.itemSummaries && ebayData.itemSummaries.length > 0) {
          // Use MEDIAN price for better outlier rejection
          const prices = ebayData.itemSummaries
            .map((item: any) => parseFloat(item.price.value))
            .filter((p: number) => !isNaN(p))
            .sort((a: number, b: number) => a - b);

          if (prices.length > 0) {
            const mid = Math.floor(prices.length / 2);
            const medianPrice = prices.length % 2 !== 0 
              ? prices[mid] 
              : (prices[mid - 1] + prices[mid]) / 2;
              
            console.log(`eBay enrichment successful. Found ${prices.length} items. Updating price from ${result.estimatedMarketValue} to Median: ${medianPrice.toFixed(2)}`);
            result.estimatedMarketValue = parseFloat(medianPrice.toFixed(2));
          }
        } else {
          console.log(`No active eBay auctions found for "${searchQuery}". Falling back to AI estimation ${result.estimatedMarketValue}`);
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
