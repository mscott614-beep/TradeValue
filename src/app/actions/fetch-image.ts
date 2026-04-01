"use server";

/**
 * Attempts to fetch an image URL with specific headers and returns the response,
 * or null if the request fails.
 */
async function tryFetch(imageUrl: string, referer: string): Promise<Response | null> {
    try {
        const res = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/webp,image/avif,image/png,image/jpeg,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                ...(referer ? { 'Referer': referer } : {}),
            },
            signal: AbortSignal.timeout(10000),
        });
        return res;
    } catch {
        return null;
    }
}

/**
 * Server-side image proxy that fetches an external image URL and returns
 * it as a base64 data URL. Bypasses CORS restrictions.
 *
 * Anti-403 strategy:
 *   1. First try with the URL's own origin as Referer (defeats most anti-hotlink rules).
 *   2. If still 403, retry with no Referer (some CDNs prefer anonymous requests).
 *   3. If still blocked, return the error.
 */
export async function fetchAndEncodeImageAction(imageUrl: string): Promise<{
    success: boolean;
    dataUrl?: string;
    error?: string;
}> {
    if (!imageUrl || !imageUrl.startsWith('http')) {
        return { success: false, error: "Invalid image URL." };
    }

    // Derive the site's own origin for the Referer header
    let siteOrigin = '';
    try {
        siteOrigin = new URL(imageUrl).origin + '/';
    } catch {
        siteOrigin = 'https://www.google.com/';
    }

    // Attempt 1: Site's own origin as Referer
    let response = await tryFetch(imageUrl, siteOrigin);

    // Attempt 2: No Referer (blank) — some CDNs block non-empty referers from other servers
    if (!response || (response.status === 403 || response.status === 401)) {
        response = await tryFetch(imageUrl, '');
    }

    // Attempt 3: Google as Referer (original behaviour)
    if (!response || (response.status === 403 || response.status === 401)) {
        response = await tryFetch(imageUrl, 'https://www.google.com/');
    }

    if (!response) {
        return { success: false, error: 'Image fetch timed out or network error.' };
    }

    if (!response.ok) {
        return { success: false, error: `Server returned ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
        return { success: false, error: `URL did not return an image (got: ${contentType})` };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
        return { success: false, error: 'Image too large to proxy (>5MB).' };
    }

    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;
    return { success: true, dataUrl };
}
