/**
 * Dev utility: list Cloud Tasks queues in us-east4 (production Functions region).
 * Usage: node functions/list-queues.js
 */
const { CloudTasksClient } = require("@google-cloud/tasks");

const PROJECT_ID = "puckvaluebak-38609945-5e85c";
const REGION = "us-east4";

async function listQueues() {
  const client = new CloudTasksClient();
  const parent = `projects/${PROJECT_ID}/locations/${REGION}`;
  try {
    const [queues] = await client.listQueues({ parent });
    console.log(`Queues in ${REGION}:`);
    queues.forEach((q) => console.log(q.name));
  } catch (error) {
    console.error("Error listing queues:", error);
  }
}

listQueues();
