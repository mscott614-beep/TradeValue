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
        console.log(`Fetching eBay URL: ${url}`);

        // Fetch HTML using axios for better error detail
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // eBay often puts key details in the title, meta tags, and item specifics.
        const title = $('.x-item-title__mainTitle').text().trim() ||
            $('h1#itemTitle').text().replace(/Details about\s+/i, '').trim() ||
            $('title').text().replace(/\| eBay$/i, '').trim() || '';

        const metaDescription = $('meta[name="description"]').attr('content') ||
            $('meta[property="og:description"]').attr('content') || '';

        // Try to grab item specifics if possible (they are often in definition lists or specific classes)
        let itemSpecifics = '';
        $('.ux-labels-values, .itemAttr, .section-specifics').each((i: number, el: any) => {
            // New eBay layout
            const labelContent = $(el).find('.ux-labels-values__labels-content, .ux-labels-values__labels').text().trim();
            const valueContent = $(el).find('.ux-labels-values__values-content, .ux-labels-values__values').text().trim();

            if (labelContent && valueContent) {
                // Remove trailing colons from labels if they exist
                const cleanLabel = labelContent.replace(/:$/, '').trim();
                itemSpecifics += `${cleanLabel}: ${valueContent}\n`;
            } else if (!labelContent) {
                // Fallback for older/different layouts which might use <td>, <th>, etc.
                const rowText = $(el).text().trim().replace(/\s+/g, ' ');
                if (rowText.length > 5) {
                    itemSpecifics += `${rowText}\n`;
                }
            }
        });

        // Current price
        const price = $('.x-price-primary').text().trim() ||
            $('.x-bin-price__content').text().trim() ||
            $('span[itemprop="price"]').text().trim() || '';

        const compiledText = `
        Title: ${title}
        Meta Description: ${metaDescription}
        Price: ${price}
        Specifics:
        ${itemSpecifics}
        `;

        if (!title && !metaDescription && !itemSpecifics && !price) {
            throw new Error("Could not extract any meaningful text from the page.");
        }

        console.log("Extracted raw text, sending to AI...");
        const result = await extractEbayListing({ 
            text: compiledText,
            model: useFallback ? FALLBACK_MODEL : PRIMARY_MODEL
        });

        return {
            success: true,
            data: result
        };

    } catch (error: any) {
        console.error("Error extracting eBay listing:", error);
        
        const errorMessage = error.message || "";
        const isOverloaded = errorMessage.includes("503") || 
                            errorMessage.includes("high demand") || 
                            errorMessage.includes("UNAVAILABLE");

        return {
            success: false,
            error: error.message || "An unexpected error occurred while fetching the eBay listing.",
            isModelOverloaded: isOverloaded
        };
    }
}
