/**
 * Dev utility: smoke-test task queue enqueue (us-east4).
 * Usage: node functions/test-queue.js
 */
const admin = require("firebase-admin");
const { getFunctions } = require("firebase-admin/functions");

const PROJECT_ID = "puckvaluebak-38609945-5e85c";
const REGION = "us-east4";

admin.initializeApp({ projectId: PROJECT_ID });

const queue = getFunctions().taskQueue(
  "locations/us-east4/functions/geminiProcessingQueue"
);

console.log("Enqueueing test task to geminiProcessingQueue (us-east4)...");
queue
  .enqueue({ jobId: "TEST_JOB_DO_NOT_RUN" }, { scheduleDelaySeconds: 3600 })
  .then(() => console.log("Enqueue OK (delayed 1h — cancel in console if needed)."))
  .catch((e) => console.error("Enqueue failed:", e.message));
