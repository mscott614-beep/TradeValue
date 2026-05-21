/**
 * Resolves AGENT_SERVICE_URL at call time (not module load) so App Hosting
 * runtime / rollout env vars are picked up correctly in server actions.
 */
export function resolveAgentServiceUrl(
  type?: "valuation" | "analysis"
): string {
  const agentUrl = process.env["AGENT_SERVICE_URL"];

  if (agentUrl === undefined || agentUrl === null || String(agentUrl).trim() === "") {
    const purpose = type ? `the ${type} agent` : "the agent service";
    throw new Error(
      `AGENT_SERVICE_URL is not configured. Set it in apphosting.yaml (or your deployment environment) before calling ${purpose}.`
    );
  }

  return String(agentUrl).trim().replace(/\/+$/, "");
}
