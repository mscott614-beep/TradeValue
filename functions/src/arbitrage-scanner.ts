/**
 * Background slab-to-raw arbitrage scanner (eBay Browse API).
 */
import * as admin from "firebase-admin";
import { EbayService } from "./ebay";
import { buildEbayQuery, calculateTradeValue, isNoiseListing } from "./ebay-pricing";
import {
  buildCardKey,
  DEFAULT_WATCHLIST,
  scoreArbitrageOpportunity,
  watchlistFromReportRows,
  type CardWatchDescriptor,
} from "./arbitrage";

const COLLECTION = "arbitrage_signals";
const SIGNAL_TTL_HOURS = parseInt(process.env.ARBITRAGE_SIGNAL_TTL_HOURS || "48", 10);
const SCAN_COOLDOWN_HOURS = parseInt(process.env.ARBITRAGE_SCAN_COOLDOWN_HOURS || "12", 10);
const MAX_WATCHLIST = parseInt(process.env.ARBITRAGE_MAX_WATCHLIST || "12", 10);

function cardTitle(d: CardWatchDescriptor): string {
  return (
    d.title ||
    [d.year, d.brand, d.set, d.player, d.cardNumber ? `#${d.cardNumber}` : ""]
      .filter(Boolean)
      .join(" ")
      .trim()
  );
}

async function loadReportWatchlist(db: admin.firestore.Firestore): Promise<CardWatchDescriptor[]> {
  try {
    const snap = await db
      .collection("market_reports")
      .orderBy("report_date", "desc")
      .limit(1)
      .get();
    if (snap.empty) return [];
    const data = snap.docs[0].data();
    const matrix = data?.slab_raw_multiplier_matrix;
    const rows = matrix?.multiplier_table || [];
    return watchlistFromReportRows(rows);
  } catch (e) {
    console.warn("[ArbitrageScan] Could not load market_reports watchlist:", e);
    return [];
  }
}

function mergeWatchlist(reportRows: CardWatchDescriptor[]): CardWatchDescriptor[] {
  const seen = new Set<string>();
  const merged: CardWatchDescriptor[] = [];
  for (const d of [...DEFAULT_WATCHLIST, ...reportRows]) {
    const key = buildCardKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(d);
  }
  return merged.slice(0, MAX_WATCHLIST);
}

function shouldSkipEbayScan(existing: admin.firestore.DocumentSnapshot | null): boolean {
  if (!existing?.exists) return false;
  const data = existing.data();
  const detectedAt = data?.detectedAt;
  if (!detectedAt || typeof detectedAt !== "string") return false;
  const detectedMs = new Date(detectedAt).getTime();
  if (isNaN(detectedMs)) return false;
  const ageMs = Date.now() - detectedMs;
  if (ageMs >= SCAN_COOLDOWN_HOURS * 3600 * 1000) return false;
  // Skip duplicate eBay pulls if we already have comps for this card
  return typeof data?.rawMedianUsd === "number" && data.rawMedianUsd > 0;
}

function findBestUnderpricedListing(
  items: any[],
  slabMedian: number,
  expectedMult: number
): { title: string; price: number; url: string; imageUrl?: string } | undefined {
  const fairRaw = slabMedian / Math.max(expectedMult, 2);
  const threshold = fairRaw * 0.82;
  let best: { title: string; price: number; url: string; imageUrl?: string } | undefined;

  for (const item of items || []) {
    if (isNoiseListing(item.title || "")) continue;
    const price = parseFloat(item.price?.value || "0");
    const shipping = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || "0");
    const total = price + shipping;
    if (total <= 0 || total >= threshold) continue;
    if (!best || total < best.price) {
      best = {
        title: item.title || "Raw listing",
        price: parseFloat(total.toFixed(2)),
        url: item.itemWebUrl || "#",
        imageUrl: item.image?.imageUrl,
      };
    }
  }
  return best;
}

export async function runArbitrageScan(
  db: admin.firestore.Firestore,
  ebay: EbayService
): Promise<{ scanned: number; signals: number; skippedCooldown: number }> {
  const reportWatch = await loadReportWatchlist(db);
  const watchlist = mergeWatchlist(reportWatch);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SIGNAL_TTL_HOURS * 3600 * 1000).toISOString();
  const detectedAt = now.toISOString();

  let signalCount = 0;
  let skippedCooldown = 0;
  const batch = db.batch();

  for (const card of watchlist) {
    try {
      const cardKey = buildCardKey(card);
      const docId = cardKey.replace(/[^a-z0-9_|.-]/gi, "_").slice(0, 128);
      const existingSnap = await db.collection(COLLECTION).doc(docId).get();
      if (shouldSkipEbayScan(existingSnap)) {
        skippedCooldown += 1;
        continue;
      }

      const rawCard = {
        year: card.year,
        brand: card.brand,
        set: card.set,
        player: card.player,
        cardNumber: card.cardNumber,
        parallel: card.parallel,
        condition: "Raw",
      };
      const slabCard = { ...rawCard, condition: "PSA 10" };

      const { query: rawQuery } = buildEbayQuery(rawCard);
      const { query: slabQuery } = buildEbayQuery(slabCard);

      const [rawRes, slabRes] = await Promise.all([
        ebay.searchActiveItems(rawQuery, 30, "price", true),
        ebay.searchActiveItems(slabQuery, 30, "price", true),
      ]);

      const rawItems = rawRes.itemSummaries || [];
      const slabItems = slabRes.itemSummaries || [];
      const rawCalc = calculateTradeValue(rawItems);
      const slabCalc = calculateTradeValue(slabItems);

      const rawMedian = rawCalc.value;
      const slabMedian = slabCalc.value;
      const expectedMult = card.expectedMultiplier || 8;

      const bestListing = findBestUnderpricedListing(
        rawItems,
        slabMedian,
        expectedMult
      );

      const scored = scoreArbitrageOpportunity({
        rawMedianUsd: rawMedian,
        slabMedianUsd: slabMedian,
        multiplierExpected: expectedMult,
        bestRawPrice: bestListing?.price,
        gradingPassRate: card.gradingPassRate,
      });

      const payload = {
        cardKey,
        player: card.player,
        year: card.year,
        brand: card.brand,
        cardNumber: card.cardNumber || "",
        title: cardTitle(card),
        rawMedianUsd: rawMedian,
        slabMedianUsd: slabMedian,
        multiplierObserved: scored.multiplierObserved,
        multiplierExpected: expectedMult,
        spreadUsd: scored.spreadUsd,
        spreadPct: scored.spreadPct,
        arbitrageScore: scored.arbitrageScore,
        confidence: scored.confidence,
        gradingPassRate: card.gradingPassRate || "moderate",
        gradingNote: scored.gradingNote,
        bestRawListing: bestListing || null,
        rawQuery,
        slabQuery,
        detectedAt,
        expiresAt,
        status: scored.qualifies ? "active" : "expired",
        qualifies: scored.qualifies,
      };

      batch.set(db.collection(COLLECTION).doc(docId), payload, { merge: true });

      if (scored.qualifies) {
        signalCount += 1;
        console.log(
          `[ArbitrageScan] SIGNAL ${card.player}: raw $${rawMedian} slab $${slabMedian} ` +
            `${scored.multiplierObserved}x vs ${expectedMult}x expected`
        );
      }
    } catch (err) {
      console.error(`[ArbitrageScan] Failed for ${card.player}:`, err);
    }
  }

  await batch.commit();
  console.log(
    `[ArbitrageScan] Done. watchlist=${watchlist.length} active_signals=${signalCount} ` +
      `skipped_cooldown=${skippedCooldown}`
  );
  return { scanned: watchlist.length, signals: signalCount, skippedCooldown };
}
