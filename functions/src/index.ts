import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { getFunctions } from "firebase-admin/functions";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";

admin.initializeApp();

const GOOGLE_GENAI_API_KEY = defineSecret("GOOGLE_GENAI_API_KEY");
const EBAY_CLIENT_ID = defineSecret("EBAY_CLIENT_ID");
const EBAY_CLIENT_SECRET = defineSecret("EBAY_CLIENT_SECRET");
const EBAY_ENV = defineSecret("EBAY_ENV");

import { EbayService } from "./ebay";

// Initialize Genkit inside the function to use the secret
const getGenkit = (apiKey: string) => {
  return genkit({
    plugins: [googleAI({ apiKey })],
    model: "googleai/gemini-3.1-flash-lite-preview",
  });
};

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

      const ai = getGenkit(GOOGLE_GENAI_API_KEY.value());

      // Define Output Schema
      const ScanOutputSchema = z.object({
        year: z.string(),
        brand: z.string(),
        player: z.string(),
        cardNumber: z.string(),
        parallel: z.string().default("Base"),
        estimatedGrade: z.string(),
        grader: z.string().default("None"),
        estimatedMarketValue: z.number(),
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
        const ebay = new EbayService(
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
        
        const ebayData = await ebay.searchActiveAuctions(searchQuery, 5);
        
        if (ebayData.itemSummaries && ebayData.itemSummaries.length > 0) {
          // Calculate an average of the top results or just take the median
          const prices = ebayData.itemSummaries.map(item => parseFloat(item.price.value)).filter(p => !isNaN(p));
          if (prices.length > 0) {
            const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
            console.log(`eBay enrichment successful. Found ${prices.length} items. Updating price from ${result.estimatedMarketValue} to ${avgPrice.toFixed(2)}`);
            result.estimatedMarketValue = parseFloat(avgPrice.toFixed(2));
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
