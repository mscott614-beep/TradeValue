import { z } from "zod";
import {
  extractCopyrightSeason,
  normalizeHockeyCardYear,
  normalizeSeason,
} from "./hockey-card-year";
import { calculateCardBorders } from "./image-boundary-scanner";

export const ScanOutputSchema = z.object({
  year: z.string().describe("Year or season on the card, e.g. 1987-88"),
  brand: z.string().describe("Manufacturer, e.g. O-Pee-Chee, Topps"),
  set: z.string().nullable().describe("Subset/series name"),
  player: z.string().describe("Player full name"),
  cardNumber: z.string().describe("Card number as printed on the back. DO NOT infer the card number by looking at the player's jersey in the photograph."),
  parallel: z.string().default("Base"),
  grade: z.string().nullable().describe("Numeric grade printed on the slab (e.g., '5', '8'). ONLY provide this if the card is physically enclosed in a third-party grading slab. If the card is raw/ungraded, you MUST set this to null. Do NOT output an estimated grade here."),
  grader: z.string().nullable().describe("Grading company acronym (e.g., 'PSA', 'BGS'). ONLY provide this if the card is physically enclosed in a third-party grading slab. If the card is raw/ungraded, you MUST set this to null."),
  conditionAssessment: z.object({
    centeringRatio: z.string().describe('You MUST explain your math. Example: "Left cardboard margin is 10%, Right is 90%. Top is 50%, Bottom is 50%. Final Ratio: 10/90 L/R, 50/50 T/B." Do not just output the ratio, write out the margin measurements first.'),
    edgeWearAlerts: z.array(z.string()).describe('List of noted issues, e.g., ["surface silvering", "minor corner softening top-left"]'),
    estimatedGradeTarget: z.string().describe('e.g., "PSA 8 - PSA 9 Near-Mint/Mint"'),
    conditionConfidenceScore: z.number().min(0).max(100).describe('0-100 score indicating visual clarity confidence')
  }).describe('Visual assessment of the physical condition of the card. ONLY provide this for RAW cards. If the card is already in a grading slab (PSA, BGS, etc.), you MUST set conditionAssessment to null.').nullable(),
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
    .describe("Card number exactly as printed (usually on back, often in the top corners, e.g. '6' or '202'). DO NOT infer by looking at the player's jersey."),
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

// Prompt generators moved inside identifyCardFromImages to handle dynamic flags.

export async function identifyCardFromImages(
  ai: { generate: (opts: any) => Promise<any> },
  payload: { frontPhotoDataUri: string; backPhotoDataUri?: string | null; isSingleScan?: boolean },
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

  let borderMetricsStr = "";
  try {
    const base64Data = payload.frontPhotoDataUri.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");
    const metrics = await calculateCardBorders(imageBuffer);
    borderMetricsStr = `\n[SYSTEM INJECTED BORDER METRICS]
The backend image pre-processor has already calculated the physical margins of this card:
- Calculated Left/Right Ratio: ${metrics.leftRightRatio}
- Calculated Top/Bottom Ratio: ${metrics.topBottomRatio}
- Hard Miscut Flag: ${metrics.isMiscut ? 'true' : 'false'}
- Raw Margins (px): L=${metrics.margins.left}, R=${metrics.margins.right}, T=${metrics.margins.top}, B=${metrics.margins.bottom}

CRITICAL INSTRUCTION: If you visually determine this is a "full-bleed", "borderless", "foil", or "die-cut" card design (like Upper Deck Dazzlers, where there is no standard cardboard border), the pre-processor metrics may be inaccurate. In that case, you may safely ignore these injected metrics and estimate centering visually yourself. 

However, if the card has clear standard cardboard borders:
1. You MUST use these exact injected ratios for your condition assessment.
2. If the Hard Miscut Flag is true, or if either ratio shows a split worse than 70/30, you must ignore any clean surfaces or sharp corners you think you see. You are forbidden from outputting an optimistic grade. Your final JSON output for estimatedGradeTarget MUST be capped at a maximum value of PSA 6 or lower.\n`;
  } catch (err) {
    console.warn("[Scanner] Failed to calculate card borders:", err);
  }

  const conditionRuleFront = payload.isSingleScan
    ? `6. A deep visual diagnostic of the condition:
   - CRITICAL: GEOMETRIC ANCHORING & SEVERE ASYMMETRY PROTOCOL. You are currently misinterpreting severe card asymmetry as a balanced 45/55 split. You must completely reset your spatial coordinate tracking by performing the following strict geometric audit before making any grading judgments. 1. Locate the absolute physical edge of the entire image asset (the outermost pixels of the card canvas). 2. Measure inward from the extreme LEFT outer boundary to the first graphic line of the inner card artwork. Note this pixel distance as [L_Margin]. 3. Measure inward from the extreme RIGHT outer boundary to the last graphic line of the inner card artwork. Note this pixel distance as [R_Margin]. Execute this Explicit Chain-of-Thought Validation: Compare [L_Margin] directly to [R_Margin]. Is one margin visibly microscopic, near-zero, or multi-times smaller than the other? If [L_Margin] is less than 15% of the total combined margins, do NOT output a balanced ratio. You are likely anchoring to an internal graphic line instead of the true physical border. You must explicitly state: "Checking for extreme negative space collapse." If one side has virtually no background margin compared to the opposite side, you must flag this as an extreme 5/95 to 10/90 structural asymmetry. Strict Rule: If there is an obvious visual imbalance where the artwork is jammed against one edge and wide open on the other, any output declaring a 45/55 or 50/50 split is a geometric failure and violates instructions. Adjust your calculated ratio to reflect the raw imbalance. Hard Rule: If centering is 10/90 or worse, the 'estimatedGradeTarget' MUST be capped at a maximum of PSA 5 to PSA 6 (Excellent to Excellent-Mint), or flagged with a mandatory "MC" (Miscut) qualifier in your notes.
   - Inspect the contrast points along the four corners and perimeter edges. Look for white chipping spots, fraying fibers, surface scratches, or print lines.
   - Output a realistic, highly defensive condition grading target based on standard hobby registries (like PSA/BGS). Avoid grading hallucinations by relying strictly on clear, visible structural elements.`
    : `6. DO NOT provide a conditionAssessment. Set conditionAssessment to null.`;

  const conditionRuleStandard = payload.isSingleScan
    ? `6. A deep visual diagnostic of the condition:
   - CRITICAL: GEOMETRIC ANCHORING & SEVERE ASYMMETRY PROTOCOL. You are currently misinterpreting severe card asymmetry as a balanced 45/55 split. You must completely reset your spatial coordinate tracking by performing the following strict geometric audit before making any grading judgments. 1. Locate the absolute physical edge of the entire image asset (the outermost pixels of the card canvas). 2. Measure inward from the extreme LEFT outer boundary to the first graphic line of the inner card artwork. Note this pixel distance as [L_Margin]. 3. Measure inward from the extreme RIGHT outer boundary to the last graphic line of the inner card artwork. Note this pixel distance as [R_Margin]. Execute this Explicit Chain-of-Thought Validation: Compare [L_Margin] directly to [R_Margin]. Is one margin visibly microscopic, near-zero, or multi-times smaller than the other? If [L_Margin] is less than 15% of the total combined margins, do NOT output a balanced ratio. You are likely anchoring to an internal graphic line instead of the true physical border. You must explicitly state: "Checking for extreme negative space collapse." If one side has virtually no background margin compared to the opposite side, you must flag this as an extreme 5/95 to 10/90 structural asymmetry. Strict Rule: If there is an obvious visual imbalance where the artwork is jammed against one edge and wide open on the other, any output declaring a 45/55 or 50/50 split is a geometric failure and violates instructions. Adjust your calculated ratio to reflect the raw imbalance. Hard Rule: If centering is 10/90 or worse, the 'estimatedGradeTarget' MUST be capped at a maximum of PSA 5 to PSA 6 (Excellent to Excellent-Mint), or flagged with a mandatory "MC" (Miscut) qualifier in your notes.
   - Inspect the contrast points along the four corners and perimeter edges on both sides. Look for white chipping spots, fraying fibers, surface scratches, or print lines.
   - Output a realistic, highly defensive condition grading target based on standard hobby registries (like PSA/BGS). Avoid grading hallucinations by relying strictly on clear, visible structural elements.`
    : `6. DO NOT provide a conditionAssessment. Set conditionAssessment to null.`;

  const FRONT_ONLY_IDENTIFY_PROMPT_PREFIX = `You are an expert trading card cataloguer.

Using the provided front image and the OCR transcription below, identify the trading card's player, manufacturer (brand), card number, and product year/season.

Since you only have the front of the card, you MUST use your visual recognition and extensive trading card catalog knowledge to determine:
1. The exact product year/season (normalized to YYYY-YY or YYYY format, e.g. 1965-66, or 1965, or 1999-00). Note that for vintage card designs (e.g., the 1959 Topps circular porthole vignette design with slanted lowercase cursive text), the release year and card number are NOT printed on the front. You MUST ignore any random digits or letters in the raw OCR and rely strictly on your visual checklist catalog knowledge of that design set to resolve the exact correct year (e.g., 1959) and card checklist number.
2. The manufacturer brand (e.g. Topps, Upper Deck, Fleer, OPC).
3. The exact card number from the set (e.g. Rip Coleman is card #51, Vito Valentinetti is #44, Bill Hall is #49, Bill Henry is #46 in 1959 Topps Baseball).
4. The exact player full name as spelled on the card.
5. The subset or series name if applicable.
6. GRADING RULES:
   - If the card is professionally graded (encased in a plastic grading slab with a company label like PSA, BGS, SGC, or CGC), set "grader" to the company acronym (e.g., "PSA", "BGS", "SGC", "CGC") and "grade" to the numeric grade (e.g., "10", "9", "8.5").
   - If the card is RAW/ungraded (i.e. not in a professional slab), you MUST set "grader" to null and "grade" to null. Do NOT return "RAW", "Raw", or any placeholder string for these fields.
${conditionRuleFront}${borderMetricsStr}

OCR TRANSCRIPTION:
`;

  const IDENTIFY_PROMPT_PREFIX = `You are an expert trading card cataloguer.

Using the provided images and the OCR transcription below, produce the final card identity JSON.

RULES:
1. If yearSeason is present in OCR, the "year" field MUST match it exactly (normalize to YYYY-YY).
2. If cardNumber is present in OCR, "cardNumber" MUST match it (strip leading # only).
3. Never substitute a famous/default Gretzky checklist card (e.g. do not output 1979-80 or #1 unless OCR shows that).
4. brand = manufacturer only. set = subset name only.
5. For 1980s O-Pee-Chee hockey, common seasons include 1986-87, 1987-88, 1988-89 — verify digits against OCR.
${conditionRuleStandard}${borderMetricsStr}
7. DO NOT identify or infer the card number by looking at the player's jersey in the photograph. Only use numbers that are explicitly printed as the card number index. Note: Card numbers are generally (but not always) found on the top corners of the back of the card.
8. GRADING RULES:
   - If the card is professionally graded (encased in a plastic grading slab with a company label like PSA, BGS, SGC, or CGC), set "grader" to the company acronym (e.g., "PSA", "BGS", "SGC", "CGC") and "grade" to the numeric grade (e.g., "10", "9", "8.5").
   - If the card is RAW/ungraded (i.e. not in a professional slab), you MUST set "grader" to null and "grade" to null. Do NOT return "RAW", "Raw", or any placeholder string for these fields.

OCR TRANSCRIPTION:
`;

  const identifyPrompt = `${isFrontOnly ? FRONT_ONLY_IDENTIFY_PROMPT_PREFIX : IDENTIFY_PROMPT_PREFIX}${JSON.stringify(ocr, null, 2)}`;

  const idPromptParts: any[] = [{ text: identifyPrompt }];
  
  // ALWAYS include the front image so the vision model can visually inspect the card design and condition
  idPromptParts.push({
    media: {
      url: payload.frontPhotoDataUri,
      contentType: mimeFromDataUri(payload.frontPhotoDataUri),
    },
  });

  // If a back image was provided, include it as well
  if (!isFrontOnly && payload.backPhotoDataUri) {
    idPromptParts.push({
      media: {
        url: payload.backPhotoDataUri,
        contentType: mimeFromDataUri(payload.backPhotoDataUri),
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

  // Post-processing enforcement: If the AI generated a visual condition assessment, 
  // the card is by definition RAW. The AI sometimes mistakenly mirrors its "estimated grade"
  // into the physical grade/grader fields. We force them to null here.
  if (normalized.conditionAssessment !== null) {
    normalized.grade = null;
    normalized.grader = null;
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
