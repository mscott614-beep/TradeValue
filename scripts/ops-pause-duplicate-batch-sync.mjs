#!/usr/bin/env node
/**
 * Pauses the manual Cloud Scheduler job that duplicates globalBatchSync → /batch-sync.
 * Safe to run multiple times.
 */
import { execSync } from "child_process";

const PROJECT = "puckvaluebak-38609945-5e85c";
const LOCATION = "us-east4";
const JOB = "daily-batch-market-sync-6am";

try {
  execSync(
    `gcloud scheduler jobs pause ${JOB} --project=${PROJECT} --location=${LOCATION}`,
    { stdio: "inherit" }
  );
  console.log(`[ops] Paused ${JOB} (use globalBatchSync only).`);
} catch (e) {
  console.warn(`[ops] Could not pause ${JOB}:`, e.message || e);
}
