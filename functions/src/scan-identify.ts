import { z } from "zod";
import {
  extractCopyrightSeason,
  normalizeHockeyCardYear,
  normalizeSeason,
} from "./hockey-card-year";

export const ScanOutputSchema = z.object({
  year: z.string().describe("Year or season on the card, e.g. 1987-88"),
  brand: z.string().describe("Manufacturer, e.g. O-Pee-Chee, Topps"),
  set: z.string().nullable().describe("Subset/series name"),
  player: z.string().describe("Player full name"),
  cardNumber: z.string().describe("Card number as printed"),
  parallel: z.string().default("Base"),
  grade: z.string().nullable(),
  grader: z.string().nullable(),
  conditionAssessment: z
    .enum(["Near Mint", "Excellent", "Very Good", "Good", "Poor"])
    .default("Near Mint"),
});

export const CardOcrSchema = z.object({
  frontTextLines: z
    .array(z.string())
    .default([])
    .describe("Every legible text line on the front, smallest copyright included"),
  backTextLines: z
    .array(z.string())
    .default([])
    .describe("Every legible text line on the back"),
  // optional() — model may omit keys; enrichOcrFromTextLines fills gaps from line text
  cardNumber: z
    .string()
    .optional()
    .describe("Card number exactly as printed (usually on back)"),
  yearSeason: z
    .string()
    .optional()
    .describe(
      'Season/year printed on card, e.g. "1987-88". Transcribe digits carefully — 1987 is NOT 1978.'
    ),
  brand: z.string().optional().describe("Manufacturer if visible, e.g. O-Pee-Chee"),
  setName: z.string().optional().describe("Subset name if visible"),
  playerName: z.string().optional().describe("Player name if visible"),
});

export type CardOcrResult = z.infer<typeof CardOcrSchema>;

/** Extract year/card #/player from raw OCR lines when structured fields are missing. */
export function enrichOcrFromTextLines(ocr: CardOcrResult): CardOcrResult {
  const front = ocr.frontTextLines ?? [];
  const back = ocr.backTextLines ?? [];
  const allLines = [...front, ...back];
  const combined = allLines.join("\n");

  let yearSeason = ocr.yearSeason?.trim();
  const copyrightSeason = extractCopyrightSeason(combined);
  if (copyrightSeason) {
    yearSeason = copyrightSeason;
  } else if (!yearSeason) {
    const seasonMatch = combined.match(/\b((?:19|20)\d{2})\s*[-–/]\s*(\d{2})\b/);
    if (seasonMatch) {
      yearSeason = `${seasonMatch[1]}-${seasonMatch[2]}`;
    }
  }

  let cardNumber = ocr.cardNumber?.trim();
  if (!cardNumber) {
    const hashMatch = combined.match(/#\s*(\d{1,4})\b/i);
    const noMatch = combined.match(/\bNo\.?\s*(\d{1,4})\b/i);
    const backNum = back.join("\n").match(/\b(\d{1,4})\b/);
    cardNumber = hashMatch?.[1] || noMatch?.[1] || (back.length > 0 ? backNum?.[1] : undefined);
  }

  let playerName = ocr.playerName?.trim();
  if (!playerName) {
    const gretzky = allLines.find((l) => /gretzky/i.test(l));
    if (gretzky) playerName = "Wayne Gretzky";
    else {
      const nameLine = front.find((l) => /^[A-Z][a-z]+ [A-Z][a-z]+/.test(l.trim()));
      if (nameLine) playerName = nameLine.trim();
    }
  }

  let brand = ocr.brand?.trim();
  if (!brand) {
    if (/o-pee-chee|o pee chee|\bopc\b/i.test(combined)) brand = "O-Pee-Chee";
    else if (/upper deck/i.test(combined)) brand = "Upper Deck";
    else if (/topps/i.test(combined)) brand = "Topps";
    else if (/parkhurst/i.test(combined)) brand = "Parkhurst";
  }

  return {
    frontTextLines: front,
    backTextLines: back,
    yearSeason: yearSeason || ocr.yearSeason,
    cardNumber: cardNumber ? String(cardNumber).replace(/^#/, "") : ocr.cardNumber,
    brand: brand || ocr.brand,
    setName: ocr.setName,
    playerName: playerName || ocr.playerName,
  };
}

export function mimeFromDataUri(dataUri: string): string {
  const match = dataUri.match(/^data:([^;]+);base64,/i);
  return match?.[1] || "image/jpeg";
}

export function buildScanMediaParts(payload: {
  frontPhotoDataUri: string;
  backPhotoDataUri?: string | null;
}): any[] {
  const parts: any[] = [];
  parts.push({
    media: {
      url: payload.frontPhotoDataUri,
      contentType: mimeFromDataUri(payload.frontPhotoDataUri),
    },
  });
  if (payload.backPhotoDataUri) {
    parts.push({
      media: {
        url: payload.backPhotoDataUri,
        contentType: mimeFromDataUri(payload.backPhotoDataUri),
      },
    });
  }
  return parts;
}

const OCR_PROMPT = `You are a precision OCR system for vintage sports cards.

Transcribe ONLY text you can actually read in the image(s). Do not guess, infer, or use player knowledge.

CRITICAL FOR YEARS/SEASONS:
- Read each digit independently. "1987-88" has an EIGHT (8), not a ONE (1). "1978-80" is a different decade.
- Look for copyright lines, "OPC", "O-Pee-Chee", "Topps", and season strings on the front or back border.
- If the back image is provided, the card number and season year are usually on the back — prioritize back text for cardNumber and yearSeason.

Return JSON with ALL keys present:
- frontTextLines: array of strings (required, can be empty)
- backTextLines: array of strings (required, use [] if no back image)
- cardNumber: string if visible, otherwise omit this key
- yearSeason: string if visible (e.g. "1987-88"), otherwise omit this key
- brand, setName, playerName: include only when clearly visible`;

const FRONT_ONLY_IDENTIFY_PROMPT_PREFIX = `You are an expert trading card cataloguer.

Using the provided front image and the OCR transcription below, identify the trading card's player, manufacturer (brand), card number, and product year/season.

Since you only have the front of the card, you MUST use your visual recognition and extensive trading card catalog knowledge to determine:
1. The exact product year/season (normalized to YYYY-YY or YYYY format, e.g. 1965-66, or 1965, or 1999-00). Note that for vintage card designs (e.g., the 1959 Topps circular porthole vignette design with slanted lowercase cursive text), the release year and card number are NOT printed on the front. You MUST ignore any random digits or letters in the raw OCR and rely strictly on your visual checklist catalog knowledge of that design set to resolve the exact correct year (e.g., 1959) and card checklist number.
2. The manufacturer brand (e.g. Topps, Upper Deck, Fleer, OPC).
3. The exact card number from the set (e.g. Rip Coleman is card #51, Vito Valentinetti is #44, Bill Hall is #49, Bill Henry is #46 in 1959 Topps Baseball).
4. The exact player full name as spelled on the card.
5. The subset or series name if applicable.

OCR TRANSCRIPTION:
`;

const IDENTIFY_PROMPT_PREFIX = `You are an expert trading card cataloguer.

Using ONLY the OCR transcription below (not general knowledge about famous cards), produce the final card identity JSON.

RULES:
1. If yearSeason is present in OCR, the "year" field MUST match it exactly (normalize to YYYY-YY).
2. If cardNumber is present in OCR, "cardNumber" MUST match it (strip leading # only).
3. Never substitute a famous/default Gretzky checklist card (e.g. do not output 1979-80 or #1 unless OCR shows that).
4. brand = manufacturer only. set = subset name only.
5. For 1980s O-Pee-Chee hockey, common seasons include 1986-87, 1987-88, 1988-89 — verify digits against OCR.

OCR TRANSCRIPTION:
`;

export async function identifyCardFromImages(
  ai: { generate: (opts: any) => Promise<any> },
  payload: { frontPhotoDataUri: string; backPhotoDataUri?: string | null },
  primaryModel: string,
  fallbackModel: string
): Promise<z.infer<typeof ScanOutputSchema>> {
  const mediaParts = buildScanMediaParts(payload);

  const runGenerate = async (model: string, prompt: any, schema: z.ZodTypeAny) => {
    return ai.generate({
      model,
      prompt,
      output: { schema },
      config: { temperature: 0, maxOutputTokens: 2048 },
    });
  };

  const MinimalOcrSchema = z.object({
    frontTextLines: z.array(z.string()).default([]),
    backTextLines: z.array(z.string()).default([]),
  });

  let ocrResponse;
  try {
    ocrResponse = await runGenerate(
      primaryModel,
      [{ text: OCR_PROMPT }, ...mediaParts],
      CardOcrSchema
    );
  } catch (err: any) {
    console.warn(`[Scanner] OCR pass failed (${err.message}), retrying fallback model...`);
    try {
      ocrResponse = await runGenerate(
        fallbackModel,
        [{ text: OCR_PROMPT }, ...mediaParts],
        CardOcrSchema
      );
    } catch (err2: any) {
      console.warn(
        `[Scanner] OCR strict schema failed (${err2.message}), using minimal schema...`
      );
      ocrResponse = await runGenerate(
        fallbackModel,
        [{ text: OCR_PROMPT }, ...mediaParts],
        MinimalOcrSchema
      );
    }
  }

  let ocr = ocrResponse.output as CardOcrResult | null;
  if (!ocr) {
    throw new Error("OCR pass failed to return structured text.");
  }

  ocr = enrichOcrFromTextLines(ocr);

  const isFrontOnly = !payload.backPhotoDataUri;
  if (isFrontOnly) {
    // For front-only scans, card numbers and years are almost never printed on the front.
    // Clear out OCR-extracted fields to prevent hallucinated numbers from overriding correct visual cataloging.
    ocr.yearSeason = undefined;
    ocr.cardNumber = undefined;
  }

  console.log(
    "[Scanner] OCR yearSeason:",
    ocr.yearSeason,
    "cardNumber:",
    ocr.cardNumber,
    "lines:",
    (ocr.frontTextLines?.length ?? 0) + (ocr.backTextLines?.length ?? 0)
  );

  const identifyPrompt = `${isFrontOnly ? FRONT_ONLY_IDENTIFY_PROMPT_PREFIX : IDENTIFY_PROMPT_PREFIX}${JSON.stringify(ocr, null, 2)}`;

  const idPromptParts: any[] = [{ text: identifyPrompt }];
  if (isFrontOnly) {
    // Include front image part so the vision model can visually inspect the card design
    idPromptParts.push({
      media: {
        url: payload.frontPhotoDataUri,
        contentType: mimeFromDataUri(payload.frontPhotoDataUri),
      },
    });
  }

  let idResponse;
  try {
    idResponse = await runGenerate(
      primaryModel,
      idPromptParts,
      ScanOutputSchema
    );
  } catch (err: any) {
    console.warn(`[Scanner] Identify pass failed (${err.message}), retrying...`);
    idResponse = await runGenerate(
      fallbackModel,
      idPromptParts,
      ScanOutputSchema
    );
  }

  const result = idResponse.output as z.infer<typeof ScanOutputSchema> | null;
  if (!result) {
    throw new Error("Identify pass failed to return structured output.");
  }

  return reconcileScanWithOcr(result, ocr);
}

/** Prefer OCR-printed year/number when the vision model drifts. */
export function reconcileScanWithOcr(
  result: z.infer<typeof ScanOutputSchema>,
  ocr: CardOcrResult
): z.infer<typeof ScanOutputSchema> {
  const normalized = { ...result };

  // If identify pass missed year but OCR lines contain a season, use it
  if (!normalized.year?.trim() && ocr.yearSeason?.trim()) {
    normalized.year = normalizeSeason(ocr.yearSeason);
  }

  if (ocr.cardNumber?.trim()) {
    const ocrNum = ocr.cardNumber.replace(/^#/, "").trim();
    const resultNum = (result.cardNumber || "").replace(/^#/, "").trim();
    if (ocrNum && ocrNum !== resultNum) {
      console.warn(
        `[Scanner] Card # corrected from "${result.cardNumber}" to OCR "${ocrNum}"`
      );
      normalized.cardNumber = ocrNum;
    }
  }

  if (ocr.brand?.trim() && !normalized.brand) {
    normalized.brand = ocr.brand.trim();
  }
  if (ocr.playerName?.trim() && !normalized.player) {
    normalized.player = ocr.playerName.trim();
  }
  if (ocr.setName?.trim() && !normalized.set) {
    normalized.set = ocr.setName.trim();
  }

  const yearFix = normalizeHockeyCardYear({
    year: normalized.year,
    brand: normalized.brand,
    player: normalized.player,
    cardNumber: normalized.cardNumber,
    set: normalized.set,
    frontTextLines: ocr.frontTextLines,
    backTextLines: ocr.backTextLines,
  });

  if (yearFix.corrected) {
    console.warn(
      `[Scanner] Hockey year normalized: "${normalized.year}" → "${yearFix.year}" (${yearFix.reason})`
    );
    normalized.year = yearFix.year;
    (normalized as any).yearCorrectionReason = yearFix.reason;
  }

  (normalized as any).ocrTranscription = ocr;
  return normalized;
}
