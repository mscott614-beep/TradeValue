/**
 * AUTO-GENERATED — do not edit.
 * Canonical source: src/lib/image-boundary-scanner.ts
 * Regenerate: node scripts/sync-shared-libs.mjs (runs via functions prebuild)
 */

import sharp from 'sharp';

export interface BorderMetrics {
  leftRightRatio: string;
  topBottomRatio: string;
  isMiscut: boolean;
  margins: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
}

/**
 * Processes an uploaded trading card image buffer and scans inward from the absolute outer boundary pixels.
 * Calculates the exact width of the card's outer borders before hitting a high-contrast transition (inner artwork/frame).
 * Returns ratios and a boolean indicating if the card is severely miscut.
 */
export async function calculateCardBorders(imageBuffer: Buffer): Promise<BorderMetrics> {
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Helper to get pixel intensity (0-255)
  const getPixel = (x: number, y: number) => {
    if (x < 0) x = 0; if (x >= width) x = width - 1;
    if (y < 0) y = 0; if (y >= height) y = height - 1;
    return data[y * width + x];
  };

  // Helper to extract a 1D slice
  const getHorizontalSlice = (yCenter: number, thickness: number) => {
    const profile = new Float32Array(width);
    const yStart = Math.max(0, Math.floor(yCenter - thickness / 2));
    const yEnd = Math.min(height, Math.floor(yCenter + thickness / 2));
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = yStart; y < yEnd; y++) sum += getPixel(x, y);
      profile[x] = sum / Math.max(1, (yEnd - yStart));
    }
    return profile;
  };

  const getVerticalSlice = (xCenter: number, thickness: number) => {
    const profile = new Float32Array(height);
    const xStart = Math.max(0, Math.floor(xCenter - thickness / 2));
    const xEnd = Math.min(width, Math.floor(xCenter + thickness / 2));
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = xStart; x < xEnd; x++) sum += getPixel(x, y);
      profile[y] = sum / Math.max(1, (xEnd - xStart));
    }
    return profile;
  };

  // Scans a profile to find CardEdge and ArtEdge
  const findEdges = (profile: Float32Array, limit: number, direction: 1 | -1) => {
    const startIdx = direction > 0 ? 0 : limit - 1;
    const endIdx = direction > 0 ? limit : -1;
    
    // Background is assumed to be the first few pixels
    let bgSum = 0;
    for (let i = 0; i < 5; i++) bgSum += profile[startIdx + (direction * i)];
    const bgIntensity = bgSum / 5;

    let cardEdge = -1;
    let artEdge = -1;
    let stableCount = 0;

    for (let i = startIdx + (direction * 5); i !== endIdx; i += direction) {
      const current = profile[i];
      const prev = profile[i - (direction * 3)];
      const diff = Math.abs(current - prev);

      if (cardEdge === -1) {
        // 1. Detect transition from backdrop to cardboard
        // Use a high threshold (>35) to ignore soft shadows cast on the backdrop
        if (diff > 35 && Math.abs(current - bgIntensity) > 15) {
          cardEdge = i;
        }
      } else if (artEdge === -1) {
        // 2. Wait for the cardboard border to flatten out (plateau)
        if (diff < 8) {
          stableCount++;
        }
        // 3. Once we have established we are on the flat border, the next spike is the artwork frame
        if (stableCount > 2 && diff > 8) {
          artEdge = i;
          break;
        }
      }
    }

    if (cardEdge === -1) cardEdge = startIdx;
    if (artEdge === -1) artEdge = cardEdge; // fallback for cropped photos

    return { cardEdge, artEdge, margin: Math.abs(artEdge - cardEdge) };
  };

  // Pass 1: Find approximate center of the card
  const initialH = getHorizontalSlice(height / 2, Math.max(5, Math.floor(height * 0.01)));
  const initialV = getVerticalSlice(width / 2, Math.max(5, Math.floor(width * 0.01)));

  const leftApprox = findEdges(initialH, width, 1).cardEdge;
  const rightApprox = findEdges(initialH, width, -1).cardEdge;
  const topApprox = findEdges(initialV, height, 1).cardEdge;
  const bottomApprox = findEdges(initialV, height, -1).cardEdge;


  // Pass 2: Accurate margins using 5 slices to bypass glare and find irregular artwork
  const hCenters = [0.2, 0.35, 0.5, 0.65, 0.8].map(p => Math.floor(topApprox + (bottomApprox - topApprox) * p));
  const vCenters = [0.2, 0.35, 0.5, 0.65, 0.8].map(p => Math.floor(leftApprox + (rightApprox - leftApprox) * p));

  const getMinMargin = (isHoriz: boolean, direction: 1 | -1) => {
    let minMargin = Infinity;
    const centers = isHoriz ? hCenters : vCenters;
    const limit = isHoriz ? width : height;
    const thickness = isHoriz ? Math.max(5, Math.floor(height * 0.01)) : Math.max(5, Math.floor(width * 0.01));
    const getSlice = isHoriz ? getHorizontalSlice : getVerticalSlice;

    for (const c of centers) {
      if (c <= 0 || c >= (isHoriz ? height : width)) continue;
      const slice = getSlice(c, thickness);
      const margin = findEdges(slice, limit, direction).margin;
      // Margin must be reasonable (less than 35% of the card width/height)
      if (margin > 0 && margin < limit * 0.35) {
        minMargin = Math.min(minMargin, margin);
      }
    }
    return minMargin === Infinity ? 0 : minMargin;
  };

  const leftMargin = getMinMargin(true, 1);
  const rightMargin = getMinMargin(true, -1);
  const topMargin = getMinMargin(false, 1);
  const bottomMargin = getMinMargin(false, -1);

  // 5. Calculate Ratios
  const totalLr = leftMargin + rightMargin;
  const leftPct = totalLr > 0 ? Math.round((leftMargin / totalLr) * 100) : 50;
  const rightPct = totalLr > 0 ? Math.round((rightMargin / totalLr) * 100) : 50;
  const leftRightRatio = `${leftPct}/${rightPct}`;

  const totalTb = topMargin + bottomMargin;
  const topPct = totalTb > 0 ? Math.round((topMargin / totalTb) * 100) : 50;
  const bottomPct = totalTb > 0 ? Math.round((bottomMargin / totalTb) * 100) : 50;
  const topBottomRatio = `${topPct}/${bottomPct}`;

  // 6. Miscut check (if any border is 15% or less of the total combined margin)
  const isMiscut = leftPct <= 15 || rightPct <= 15 || topPct <= 15 || bottomPct <= 15;

  console.log(`[Boundary Scanner] Bounding Box: L=${leftApprox}, R=${rightApprox}, T=${topApprox}, B=${bottomApprox}`);
  console.log(`[Boundary Scanner] Margins: L=${leftMargin}, R=${rightMargin}, T=${topMargin}, B=${bottomMargin}`);
  console.log(`[Boundary Scanner] Ratios: L/R=${leftRightRatio}, T/B=${topBottomRatio}, Miscut=${isMiscut}`);

  return {
    leftRightRatio,
    topBottomRatio,
    isMiscut,
    margins: {
      left: leftMargin,
      right: rightMargin,
      top: topMargin,
      bottom: bottomMargin,
    }
  };
}
