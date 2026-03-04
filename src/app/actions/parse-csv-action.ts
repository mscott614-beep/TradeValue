"use server";

import { parseCsvTitlesFlow } from "@/ai/flows/parse-csv-titles";
import type { Portfolio } from "@/lib/types";

export async function parseCsvTitlesAction(titles: string[]) {
    try {
        const response = await parseCsvTitlesFlow(titles);
        return { success: true, result: response.results };
    } catch (error: any) {
        console.error("Parse CSV Titles Server Action Error:", error);
        return { success: false, error: error.message || "Failed to parse titles." };
    }
}
