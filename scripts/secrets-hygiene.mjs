#!/usr/bin/env node
/**
 * P5 Secret Manager hygiene for puckvaluebak project.
 * - Syncs GEMINI_API_KEY secret material from GOOGLE_GENAI_API_KEY (legacy alias)
 * - Reports unused secrets (does not delete OPENROUTER / SK_* without --prune)
 *
 * Usage:
 *   node scripts/secrets-hygiene.mjs
 *   node scripts/secrets-hygiene.mjs --prune   # disables old versions of unused secrets
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PROJECT = "puckvaluebak-38609945-5e85c";
const CANONICAL = "GOOGLE_GENAI_API_KEY";
const LEGACY_ALIAS = "GEMINI_API_KEY";
const UNUSED = ["OPENROUTER_API_KEY"];
const prune = process.argv.includes("--prune");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = path.join(root, ".tmp");
fs.mkdirSync(tmpDir, { recursive: true });

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

console.log(`[secrets-hygiene] Project: ${PROJECT}`);

try {
  const keyFile = path.join(tmpDir, "gemini-key.txt");
  sh(
    `gcloud secrets versions access latest --secret=${CANONICAL} --project=${PROJECT} > "${keyFile}"`
  );
  sh(
    `gcloud secrets versions add ${LEGACY_ALIAS} --project=${PROJECT} --data-file="${keyFile}"`
  );
  console.log(`[secrets-hygiene] Synced ${LEGACY_ALIAS} <- ${CANONICAL} (latest version).`);
  fs.unlinkSync(keyFile);
} catch (e) {
  console.warn(`[secrets-hygiene] Could not sync ${LEGACY_ALIAS}:`, e.message || e);
}

const allSecrets = sh(`gcloud secrets list --project=${PROJECT} --format="value(name)"`)
  .split("\n")
  .filter(Boolean);

console.log("\n[secrets-hygiene] Secret inventory:");
for (const name of allSecrets) {
  const flagged =
    name.startsWith("SK_") || UNUSED.includes(name) || name === LEGACY_ALIAS;
  console.log(`  ${flagged ? "⚠" : "✓"} ${name}`);
}

console.log("\n[secrets-hygiene] Recommendations:");
console.log(`  - Canonical Gemini key: ${CANONICAL} (App Hosting maps GEMINI_API_KEY env to this secret).`);
console.log(`  - Rotate/delete secrets named like API keys (SK_*) in console if unused.`);
console.log(`  - Remove ${UNUSED.join(", ")} from GCP if not used by any service.`);

if (prune) {
  for (const secret of UNUSED) {
    if (!allSecrets.includes(secret)) continue;
    try {
      sh(
        `gcloud secrets delete ${secret} --project=${PROJECT} --quiet`
      );
      console.log(`[secrets-hygiene] Deleted unused secret: ${secret}`);
    } catch (e) {
      console.warn(`[secrets-hygiene] Could not delete ${secret}:`, e.message || e);
    }
  }
} else {
  console.log("\n  Run with --prune to delete unused OPENROUTER_API_KEY (if present).");
}

console.log("\n[secrets-hygiene] App Hosting: confirm console env matches apphosting.yaml (secrets override file).");
