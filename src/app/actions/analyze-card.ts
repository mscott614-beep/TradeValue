"use server";

import { Portfolio } from "@/lib/types";
import { analyzeCardAction as analyzeCardViaAgent } from "@/app/actions/refresh-card-value";

export async function analyzeCardAction(card: Portfolio) {
    return analyzeCardViaAgent(card);
}
