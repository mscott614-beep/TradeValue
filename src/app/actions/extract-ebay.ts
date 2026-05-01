"use server";

import axios from 'axios';
import * as cheerio from 'cheerio';
import { extractEbayListing } from '@/ai/flows/extract-ebay-listing';
import { FALLBACK_MODEL, PRIMARY_MODEL } from '@/ai/genkit';

export async function extractEbayListingAction(url: string, useFallback: boolean = false) {
    if (!url.includes('ebay.com/itm/')) {
        return {
            success: false,
            error: "Invalid URL. Please provide a link to a specific eBay item (must contain 'ebay.com/itm/')."
        };
    }

    const agentBaseUrl = process.env.AGENT_SERVICE_URL;
    if (!agentBaseUrl) {
        return { success: false, error: "Agent service URL not configured." };
    }

    try {
        console.log(`[Import] Calling Python Agent to extract: ${url}`);
        
        const response = await axios.post(`${agentBaseUrl.trim()}/extract-ebay`, {
            url: url
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        if (response.data && !response.data.success === false) {
            return {
                success: true,
                data: response.data
            };
        } else {
            throw new Error(response.data.error || "Failed to extract listing details via agent.");
        }

    } catch (error: any) {
        console.error("Error extracting eBay listing via agent:", error);
        return {
            success: false,
            error: error.message || "An unexpected error occurred while fetching the eBay listing."
        };
    }
}
