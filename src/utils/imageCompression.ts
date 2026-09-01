/**
 * Detect if running on Android device
 */
function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

/**
 * Detect iPhone / iPad (including iPadOS reporting as Mac with touch)
 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
  );
}

/**
 * Rough "older / low memory device" signal. Older iPhones (8 / X / 11 / 12 era)
 * report 2-4 logical cores and Safari kills the tab when a big HEIC photo is
 * decoded into a canvas. We shrink harder on those devices.
 */
function isLowMemoryDevice(): boolean {
  const cores = (navigator as any).hardwareConcurrency ?? 4;
  const mem = (navigator as any).deviceMemory ?? (navigator as any).memory?.jsHeapSizeLimit;
  return cores <= 4 || (typeof mem === 'number' && mem <= 4);
}

/**
 * iOS Safari silently produces a blank canvas above a certain total pixel area.
 * Cap the decoded output so drawImage always succeeds.
 */
function maxPixelArea(): number {
  if (isIOS()) return isLowMemoryDevice() ? 2_500_000 : 4_000_000; // ~1.6MP-2MP output
  return 8_000_000;
}

/**
 * Compress and resize an image file to reduce memory usage.
 *
 * Never throws: if the browser cannot decode the photo (common with HEIC on
 * older iPhones) or runs out of memory, the ORIGINAL file is returned so the
 * upload still goes through instead of failing silently.
 */
export async function compressImage(
  file: File,
  maxWidth?: number,
  maxHeight?: number,
  quality?: number
): Promise<File> {
  // Non-images (e.g. PDFs) pass straight through
  if (file.type && !file.type.startsWith('image/')) return file;

  return new Promise((resolve) => {
    const fileSize = file.size;
    const isLargeFile = fileSize > 3 * 1024 * 1024; // > 3MB
    const isAndroidDevice = isAndroid();
    const lowMemory = isLowMemoryDevice();

    // Set defaults based on platform
    let targetMaxWidth: number;
    let targetMaxHeight: number;
    let targetQuality: number;

    if (isAndroidDevice || (isIOS() && lowMemory)) {
      // Android + older iPhones: more conservative for low-memory devices
      targetMaxWidth = maxWidth ?? (isLargeFile ? 800 : 1000);
      targetMaxHeight = maxHeight ?? (isLargeFile ? 800 : 1000);
      targetQuality = quality ?? (isLargeFile ? 0.55 : 0.65);
    } else {
      // Newer iOS / Desktop: higher quality
      targetMaxWidth = maxWidth ?? (isLargeFile ? 1200 : 1400);
      targetMaxHeight = maxHeight ?? (isLargeFile ? 1200 : 1400);
      targetQuality = quality ?? (isLargeFile ? 0.65 : 0.75);
    }

    // Hard cap for low-memory iPhones regardless of what the caller asked for
    if (isIOS() && lowMemory) {
      targetMaxWidth = Math.min(targetMaxWidth, 1000);
      targetMaxHeight = Math.min(targetMaxHeight, 1000);
      targetQuality = Math.min(targetQuality, 0.65);
    }

    let settled = false;
    const finish = (result: File, reason?: string) => {
      if (settled) return;
      settled = true;
      if (reason) console.warn(`[imageCompression] falling back to original: ${reason}`);
      resolve(result);
    };

    const img = new Image();
    let objectUrl: string | null = null;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      finish(file, 'could not create object URL');
      return;
    }

    // Slower phones on weak wifi need more room than 10s to decode a 4MB HEIC
    const loadTimeout = setTimeout(() => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      finish(file, 'image decode timed out');
    }, 20000);

    img.onload = () => {
      clearTimeout(loadTimeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);

      try {
        let { width, height } = img;
        if (!width || !height) {
          finish(file, 'image reported zero dimensions');
          return;
        }

        if (width > targetMaxWidth || height > targetMaxHeight) {
          const ratio = Math.min(targetMaxWidth / width, targetMaxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Respect the iOS canvas area ceiling
        const areaCap = maxPixelArea();
        if (width * height > areaCap) {
          const ratio = Math.sqrt(areaCap / (width * height));
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(file, 'no canvas context');
          return;
        }

        // White base so transparent PNG/HEIC alpha does not turn black
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const blobTimeout = setTimeout(() => {
          canvas.width = 0;
          canvas.height = 0;
          finish(file, 'canvas encode timed out');
        }, 15000);

        canvas.toBlob(
          (blob) => {
            clearTimeout(blobTimeout);
            canvas.width = 0;
            canvas.height = 0;

            // A tiny blob means iOS handed us a blank canvas — use the original
            if (!blob || blob.size < 2048) {
              finish(file, 'canvas produced empty image');
              return;
            }

            const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });

            console.log(
              `Image compressed: ${(fileSize / 1024).toFixed(0)}KB -> ${(blob.size / 1024).toFixed(0)}KB (${width}x${height})`
            );
            finish(compressedFile);
          },
          'image/jpeg',
          targetQuality
        );
      } catch (err: any) {
        finish(file, err?.message || 'canvas failure');
      }
    };

    img.onerror = () => {
      clearTimeout(loadTimeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Most common on older iPhones with HEIC / HEIF photos
      finish(file, 'browser could not decode this photo format');
    };

    img.src = objectUrl;
  });
}

/**
 * Upload a file to Supabase storage with retry logic
 * Handles flaky Android/older-iPhone connections with exponential backoff
 */
export async function uploadWithRetry(
  supabase: any,
  bucket: string,
  fileName: string,
  file: File,
  maxRetries: number = 3
): Promise<{ publicUrl: string }> {
  let lastError: Error | null = null;
  const attempts = Math.max(maxRetries, 4);

  // Keep the stored extension in sync with the real file type so the image
  // renders later (fallback path can hand us a HEIC named .jpg)
  let safeName = fileName;
  const type = file.type || 'image/jpeg';
  if (type === 'image/heic' || type === 'image/heif') {
    safeName = fileName.replace(/\.[^./]+$/, '') + '.heic';
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(`Upload attempt ${attempt}/${attempts} for ${safeName}`);

      const uploadPromise = supabase.storage
        .from(bucket)
        .upload(safeName, file, { contentType: type, upsert: false });
      // Bigger window: cellular in a walk-in cooler is slow
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out')), 60000)
      );

      const { error: uploadError } = (await Promise.race([uploadPromise, timeoutPromise])) as any;

      if (uploadError) {
        throw uploadError;
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(safeName);
      console.log(`Upload successful on attempt ${attempt}`);
      return { publicUrl: data.publicUrl };
    } catch (error: any) {
      lastError = error;
      console.error(`Upload attempt ${attempt} failed:`, error.message || error);

      // Don't retry on certain errors
      if (error.message?.includes('duplicate') || error.message?.includes('already exists')) {
        throw error;
      }

      // Wait before retrying (exponential backoff: 1s, 2s, 4s, 8s)
      if (attempt < attempts) {
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError || new Error('Upload failed after all retries');
}
