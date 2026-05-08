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

    try {
        // Step 1: Fetch the eBay page from the Next.js server (better IP reputation than Cloud Run)
        console.log(`[Import] Fetching eBay listing from Next.js server: ${url}`);
        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
            },
            timeout: 20000,
        });

        // Step 2: Extract structured text from the HTML using cheerio
        const $ = cheerio.load(html);

        // Title
        const listingTitle = $('h1.x-item-title__mainTitle span').text().trim() ||
                             $('h1 span.ux-textspans--BOLD').text().trim() ||
                             $('h1').first().text().trim();

        // Price
        const listingPrice = $('div.x-price-primary span.ux-textspans').first().text().trim() ||
                             $('span[itemprop="price"]').text().trim() ||
                             $('meta[itemprop="price"]').attr('content') || '';

        // Condition
        const condition = $('div.x-item-condition-text span.ux-textspans').text().trim() ||
                          $('span.ux-icon-text__text').text().trim() || '';

        // Item Specifics
        const itemSpecifics: Record<string, string> = {};
        $('div.ux-layout-section-evo__col').each((_, el) => {
            const spans = $(el).find('span.ux-textspans');
            if (spans.length >= 2) {
                const key = $(spans[0]).text().trim().replace(/:$/, '');
                const val = $(spans[1]).text().trim();
                if (key && val && key !== val) {
                    itemSpecifics[key] = val;
                }
            }
        });

        // Seller description (if inline)
        const descText = $('div#desc_div').text().trim().slice(0, 500) || '';

        // Build the text blob for the AI
        const structuredText = [
            `LISTING TITLE: ${listingTitle}`,
            `PRICE: ${listingPrice}`,
            `CONDITION: ${condition}`,
            `ITEM SPECIFICS: ${Object.entries(itemSpecifics).map(([k,v]) => `${k}: ${v}`).join(', ') || 'None'}`,
            descText ? `DESCRIPTION: ${descText}` : '',
        ].filter(Boolean).join('\n');

        console.log(`[Import] Extracted text (${structuredText.length} chars): ${structuredText.slice(0, 300)}`);

        if (!listingTitle) {
            return { success: false, error: "Could not extract listing title from the eBay page. The listing may be expired or private." };
        }

        // Step 3: Use the existing Genkit flow for AI extraction (no Python agent needed)
        const modelToUse = useFallback ? FALLBACK_MODEL : PRIMARY_MODEL;
        console.log(`[Import] Calling Genkit extractEbayListing with model: ${modelToUse}`);

        const result = await extractEbayListing({
            text: structuredText,
            model: modelToUse,
        });

        console.log(`[Import] SUCCESS: ${result.player} - ${result.brand} - $${result.currentMarketValue}`);

        return {
            success: true,
            data: result,
        };

    } catch (error: any) {
        console.error("[Import] Primary extraction failed:", error?.message || error);

        // Automatic fallback: if the primary model failed, retry with the fallback model
        if (!useFallback) {
            console.log("[Import] Retrying with fallback model...");
            return extractEbayListingAction(url, true);
        }

        return {
            success: false,
            error: error?.message || "An unexpected error occurred while importing the eBay listing."
        };
    }
}
