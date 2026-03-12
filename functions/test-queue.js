const admin = require("firebase-admin");
const { getFunctions } = require("firebase-admin/functions");

admin.initializeApp({ projectId: "puckvaluebak-38609945-5e85c" });

  const queue = getFunctions().taskQueue("geminiprocessingqueue", "us-central1");
  console.log("Enqueueing...");
  queue.enqueue({ test: true })
    .then(() => console.log("Success with geminiprocessingqueue!"))
    .catch(e => console.error(e.message));

  const queue2 = getFunctions().taskQueue("gemini-processing-queue", "us-central1");
  queue2.enqueue({ test: true })
    .then(() => console.log("Success with gemini-processing-queue!"))
    .catch(e => console.error(e.message));

