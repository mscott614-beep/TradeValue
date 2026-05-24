/**
 * Image processing utilities optimized for Gemini 3.5 Flash vision tasks.
 */

export async function compressCardImage(fileOrBlob: File | Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        try {
            const url = URL.createObjectURL(fileOrBlob);
            const img = new Image();

            img.onload = () => {
                URL.revokeObjectURL(url);
                
                let width = img.width;
                let height = img.height;
                const MAX_DIMENSION = 1024;

                // Scale proportionally if either dimension exceeds the max
                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    if (width > height) {
                        height = Math.round((height * MAX_DIMENSION) / width);
                        width = MAX_DIMENSION;
                    } else {
                        width = Math.round((width * MAX_DIMENSION) / height);
                        height = MAX_DIMENSION;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    console.error("[ImageProcessor] Failed to get canvas context. Falling back to original file.");
                    resolve(fileOrBlob);
                    return;
                }

                // Smooth scaling
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                // Compress to JPEG at 75% quality
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            console.error("[ImageProcessor] toBlob returned null. Falling back to original file.");
                            resolve(fileOrBlob);
                        }
                    },
                    'image/jpeg',
                    0.75
                );
            };

            img.onerror = (error) => {
                console.error("[ImageProcessor] Failed to load image for compression. Falling back to original file.", error);
                URL.revokeObjectURL(url);
                resolve(fileOrBlob); // Graceful fallback
            };

            img.src = url;
        } catch (err) {
            console.error("[ImageProcessor] Unhandled exception during compression. Falling back to original file.", err);
            resolve(fileOrBlob);
        }
    });
}

/**
 * Converts a Blob to a Base64 Data URL string for Firestore ingestion.
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            resolve(reader.result as string);
        };
        reader.onerror = () => {
            reject(new Error("Failed to read blob as data URL"));
        };
        reader.readAsDataURL(blob);
    });
}
