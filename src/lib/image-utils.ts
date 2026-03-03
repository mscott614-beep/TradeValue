/**
 * Compresses an image file by resizing it proportionally to a maximum width
 * and reducing its quality as a JPEG to ensure it fits within size constraints
 * (e.g., Firestore's 1MB document limit).
 */
export async function compressImage(file: File, maxWidth: number = 600): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Could not get canvas context'));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);

                // Compress to JPEG with 0.7 quality to guarantee small payload
                const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                resolve(dataUrl);
            };

            img.onerror = reject;
            img.src = event.target?.result as string;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
