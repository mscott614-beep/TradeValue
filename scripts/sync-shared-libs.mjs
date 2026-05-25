#!/usr/bin/env node
/**
 * Copies canonical src/lib modules into functions/src before Firebase Functions build.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const banner = (name) =>
  `/**\n * AUTO-GENERATED — do not edit.\n * Canonical source: src/lib/${name}\n * Regenerate: node scripts/sync-shared-libs.mjs (runs via functions prebuild)\n */\n\n`;

const copies = [
  "hockey-card-year.ts",
  "pricing-extract.ts",
  "institutional-report-prompt.ts",
  "arbitrage.ts",
  "ebay-pricing.ts",
  "image-boundary-scanner.ts",
];

for (const name of copies) {
  const srcPath = path.join(root, "src", "lib", name);
  const destPath = path.join(root, "functions", "src", name);

  if (!fs.existsSync(srcPath)) {
    console.error(`[sync-shared-libs] Missing canonical file: ${srcPath}`);
    process.exit(1);
  }

  let body = fs.readFileSync(srcPath, "utf8");
  body = body.replace(/^\/\*\*[\s\S]*?AUTO-GENERATED[\s\S]*?\*\/\s*\n*/m, "");

  fs.writeFileSync(destPath, banner(name) + body);
  console.log(`[sync-shared-libs] ${name} -> functions/src/${name}`);
}
