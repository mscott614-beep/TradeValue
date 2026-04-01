"use server";

/**
 * Server-side image proxy that fetches an external image URL and returns
 * it as a compressed base64 data URL. This bypasses CORS restrictions
 * that prevent the browser from loading images from sites like TCDB or COMC.
 */
export async function fetchAndEncodeImageAction(imageUrl: string): Promise<{
    success: boolean;
    dataUrl?: string;
    error?: string;
}> {
    if (!imageUrl || !imageUrl.startsWith('http')) {
        return { success: false, error: "Invalid image URL." };
    }

    try {
        const response = await fetch(imageUrl, {
            headers: {
                // Masquerade as a browser to avoid bot-blocking
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/webp,image/avif,image/png,image/jpeg,*/*',
                'Referer': 'https://www.google.com/',
            },
            // 10s timeout for the image fetch
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            return { success: false, error: `Remote server returned ${response.status}: ${response.statusText}` };
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        if (!contentType.startsWith('image/')) {
            return { success: false, error: `URL did not return an image (got: ${contentType})` };
        }

        const arrayBuffer = await response.arrayBuffer();
        
        // Enforce a 5MB raw size cap before encoding
        if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
            return { success: false, error: "Image too large to proxy (>5MB)." };
        }

        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const dataUrl = `data:${contentType};base64,${base64}`;

        return { success: true, dataUrl };
    } catch (error: any) {
        const message = error?.name === 'TimeoutError'
            ? "Image fetch timed out (10s)."
            : (error?.message || "Failed to fetch image.");
        return { success: false, error: message };
    }
}
