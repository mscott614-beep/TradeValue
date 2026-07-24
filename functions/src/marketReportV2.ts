import { onRequest } from "firebase-functions/v2/https";

/**
 * Proxy function that forwards market intelligence report request payload
 * asynchronously to n8n and returns a successful status immediately.
 */
export const marketReportV2 = onRequest({
  region: "us-east4",
  memory: "256MiB",
  timeoutSeconds: 60,
  maxInstances: 2,
  concurrency: 10,
  cors: true,
}, async (req, res) => {
  // Enable CORS manually to prevent any issues on errors/preflights
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const { topic, email, userEmail } = req.body ?? {};

  // Forwards this exact payload via a POST request to the n8n production webhook URL
  fetch("https://delegation-anticipated-dust-nam.trycloudflare.com/webhook/tradevalue-async-report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic,
      email: email || userEmail,
      userEmail: userEmail || email,
    }),
  }).catch((err) => {
    console.error("Error forwarding to n8n webhook:", err);
  });

  // Return a successful 200 OK status back to the client immediately
  res.status(200).json({ success: true, message: "Report generation started asynchronously." });
});

