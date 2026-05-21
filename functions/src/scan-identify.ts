import { z } from "zod";

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
    .describe("Every legible text line on the front, smallest copyright included"),
  backTextLines: z
    .array(z.string())
    .describe("Every legible text line on the back"),
  cardNumber: z
    .string()
    .nullable()
    .describe("Card number exactly as printed (usually on back)"),
  yearSeason: z
    .string()
    .nullable()
    .describe(
      'Season/year printed on card, e.g. "1987-88". Transcribe digits carefully — 1987 is NOT 1978.'
    ),
  brand: z.string().nullable().describe("Manufacturer if visible, e.g. O-Pee-Chee"),
  setName: z.string().nullable().describe("Subset name if visible"),
  playerName: z.string().nullable().describe("Player name if visible"),
});

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

Return JSON with:
- frontTextLines: array of strings
- backTextLines: array of strings (empty if no back image)
- cardNumber: exact number from card (e.g. "183", "#183") or null
- yearSeason: exact season string printed on card (e.g. "1987-88") or null
- brand, setName, playerName: only if clearly visible`;

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

  let ocrResponse;
  try {
    ocrResponse = await runGenerate(
      primaryModel,
      [{ text: OCR_PROMPT }, ...mediaParts],
      CardOcrSchema
    );
  } catch (err: any) {
    console.warn(`[Scanner] OCR pass failed (${err.message}), retrying...`);
    ocrResponse = await runGenerate(
      fallbackModel,
      [{ text: OCR_PROMPT }, ...mediaParts],
      CardOcrSchema
    );
  }

  const ocr = ocrResponse.output as z.infer<typeof CardOcrSchema> | null;
  if (!ocr) {
    throw new Error("OCR pass failed to return structured text.");
  }

  console.log("[Scanner] OCR yearSeason:", ocr.yearSeason, "cardNumber:", ocr.cardNumber);

  const identifyPrompt = `${IDENTIFY_PROMPT_PREFIX}${JSON.stringify(ocr, null, 2)}`;

  let idResponse;
  try {
    idResponse = await runGenerate(
      primaryModel,
      [{ text: identifyPrompt }],
      ScanOutputSchema
    );
  } catch (err: any) {
    console.warn(`[Scanner] Identify pass failed (${err.message}), retrying...`);
    idResponse = await runGenerate(
      fallbackModel,
      [{ text: identifyPrompt }],
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
  ocr: z.infer<typeof CardOcrSchema>
): z.infer<typeof ScanOutputSchema> {
  const normalized = { ...result };

  if (ocr.yearSeason?.trim()) {
    const ocrYear = normalizeSeason(ocr.yearSeason);
    const resultYear = normalizeSeason(result.year || "");
    if (ocrYear && ocrYear !== resultYear) {
      console.warn(
        `[Scanner] Year corrected from "${result.year}" to OCR "${ocrYear}"`
      );
      normalized.year = ocrYear;
    }
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

  (normalized as any).ocrTranscription = ocr;
  return normalized;
}

export function normalizeSeason(raw: string): string {
  const t = raw.trim();
  const match = t.match(/(\d{4})\s*[-–/]\s*(\d{2,4})/);
  if (match) {
    const start = match[1];
    let end = match[2];
    if (end.length === 4) {
      end = end.slice(-2);
    }
    return `${start}-${end.padStart(2, "0").slice(-2)}`;
  }
  const single = t.match(/^(\d{4})$/);
  if (single) {
    const y = parseInt(single[1], 10);
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  }
  return t;
}
