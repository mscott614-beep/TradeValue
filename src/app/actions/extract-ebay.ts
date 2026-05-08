"use server";

import axios from 'axios';
import { extractEbayListing } from '@/ai/flows/extract-ebay-listing';
import { FALLBACK_MODEL, PRIMARY_MODEL } from '@/ai/genkit';

/**
 * Gets an eBay OAuth Application Access Token (client_credentials grant).
 */
async function getEbayAccessToken(): Promise<string> {
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;
    const isProduction = process.env.EBAY_ENV === 'production';

    if (!clientId || !clientSecret) {
        throw new Error("eBay API credentials not configured.");
    }

    const tokenUrl = isProduction
        ? 'https://api.ebay.com/identity/v1/oauth2/token'
        : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const { data } = await axios.post(tokenUrl, 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope', {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${credentials}`,
        },
        timeout: 10000,
    });

    return data.access_token;
}

/**
 * Extracts the legacy item ID from an eBay URL.
 * Handles formats like:
 *   https://www.ebay.com/itm/358443166922
 *   https://www.ebay.com/itm/some-title/358443166922
 */
function extractItemId(url: string): string | null {
    const match = url.match(/\/itm\/(?:.*\/)?(\d+)/);
    return match ? match[1] : null;
}

export async function extractEbayListingAction(url: string, useFallback: boolean = false) {
    if (!url.includes('ebay.com/itm/')) {
        return {
            success: false,
            error: "Invalid URL. Please provide a link to a specific eBay item (must contain 'ebay.com/itm/')."
        };
    }

    const legacyItemId = extractItemId(url);
    if (!legacyItemId) {
        return { success: false, error: "Could not extract item ID from the eBay URL." };
    }

    try {
        // Step 1: Get eBay OAuth token
        console.log(`[Import] Getting eBay access token...`);
        const accessToken = await getEbayAccessToken();

        // Step 2: Fetch item details from the eBay Browse API
        const isProduction = process.env.EBAY_ENV === 'production';
        const apiBase = isProduction
            ? 'https://api.ebay.com'
            : 'https://api.sandbox.ebay.com';

        console.log(`[Import] Fetching item ${legacyItemId} from eBay Browse API...`);
        const { data: item } = await axios.get(
            `${apiBase}/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyItemId}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
                    'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>',
                },
                timeout: 15000,
            }
        );

        // Step 3: Build structured text from API response
        const title = item.title || '';
        const price = item.price ? `$${item.price.value} ${item.price.currency}` : '';
        const conditionText = item.condition || item.conditionDescription || '';
        const categoryPath = item.categoryPath || '';
        const shortDescription = item.shortDescription || '';
        const description = item.description ? item.description.replace(/<[^>]*>/g, ' ').slice(0, 500) : '';
        const imageUrl = item.image?.imageUrl || '';

        // Extract item specifics from localizedAspects
        const specifics: Record<string, string> = {};
        if (item.localizedAspects && Array.isArray(item.localizedAspects)) {
            for (const aspect of item.localizedAspects) {
                if (aspect.name && aspect.value) {
                    specifics[aspect.name] = aspect.value;
                }
            }
        }

        const structuredText = [
            `LISTING TITLE: ${title}`,
            `PRICE: ${price}`,
            `CONDITION: ${conditionText}`,
            `CATEGORY: ${categoryPath}`,
            `ITEM SPECIFICS: ${Object.entries(specifics).map(([k, v]) => `${k}: ${v}`).join(', ') || 'None'}`,
            shortDescription ? `SHORT DESCRIPTION: ${shortDescription}` : '',
            description ? `DESCRIPTION: ${description}` : '',
        ].filter(Boolean).join('\n');

        console.log(`[Import] eBay API data (${structuredText.length} chars): ${structuredText.slice(0, 400)}`);

        // Step 4: Use Genkit flow for AI-powered card metadata extraction
        const modelToUse = useFallback ? FALLBACK_MODEL : PRIMARY_MODEL;
        console.log(`[Import] Calling Genkit extractEbayListing with model: ${modelToUse}`);

        const result = await extractEbayListing({
            text: structuredText,
            model: modelToUse,
        });

        // Override the AI's price with the actual eBay price if the AI missed it
        if (result.currentMarketValue <= 0.01 && item.price?.value) {
            result.currentMarketValue = parseFloat(item.price.value) || 0;
        }

        // Attach the eBay image URL for the card
        const enrichedResult = {
            ...result,
            imageUrl: imageUrl,
            ebayUrl: url,
        };

        console.log(`[Import] SUCCESS: ${result.player} - ${result.brand} - $${result.currentMarketValue}`);

        return {
            success: true,
            data: enrichedResult,
        };

    } catch (error: any) {
        console.error("[Import] Extraction failed:", error?.response?.data || error?.message || error);

        // Automatic fallback: if the primary model failed, retry with fallback
        if (!useFallback && error?.message && !error?.message.includes('eBay API')) {
            console.log("[Import] Retrying with fallback model...");
            return extractEbayListingAction(url, true);
        }

        // Provide a helpful error message
        const ebayError = error?.response?.data?.errors?.[0]?.message;
        return {
            success: false,
            error: ebayError || error?.message || "An unexpected error occurred while importing the eBay listing."
        };
    }
}
