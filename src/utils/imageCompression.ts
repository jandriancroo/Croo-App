/**
 * Detect if running on Android device
 */
function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

/**
 * Compress and resize an image file to reduce memory usage
 * Uses higher quality for iOS/Desktop, more conservative for Android
 */
export async function compressImage(
  file: File,
  maxWidth?: number,
  maxHeight?: number,
  quality?: number
): Promise<File> {
  return new Promise((resolve, reject) => {
    const fileSize = file.size;
    const isLargeFile = fileSize > 3 * 1024 * 1024; // > 3MB
    const isAndroidDevice = isAndroid();
    
    // Set defaults based on platform
    let targetMaxWidth: number;
    let targetMaxHeight: number;
    let targetQuality: number;
    
    if (isAndroidDevice) {
      // Android: More conservative to handle low-memory devices
      targetMaxWidth = maxWidth ?? (isLargeFile ? 800 : 1000);
      targetMaxHeight = maxHeight ?? (isLargeFile ? 800 : 1000);
      targetQuality = quality ?? (isLargeFile ? 0.55 : 0.65);
    } else {
      // iOS/Desktop: Higher quality
      targetMaxWidth = maxWidth ?? (isLargeFile ? 1200 : 1400);
      targetMaxHeight = maxHeight ?? (isLargeFile ? 1200 : 1400);
      targetQuality = quality ?? (isLargeFile ? 0.65 : 0.75);
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    // Add timeout for image loading (10 seconds)
    const loadTimeout = setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image loading timed out'));
    }, 10000);

    img.onload = () => {
      clearTimeout(loadTimeout);
      // Immediately revoke to free memory
      URL.revokeObjectURL(objectUrl);

      // Calculate new dimensions maintaining aspect ratio
      let { width, height } = img;
      
      if (width > targetMaxWidth || height > targetMaxHeight) {
        const ratio = Math.min(targetMaxWidth / width, targetMaxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Draw image to canvas (this resizes it)
      ctx.drawImage(img, 0, 0, width, height);

      // Add timeout for canvas to blob conversion (5 seconds)
      const blobTimeout = setTimeout(() => {
        canvas.width = 0;
        canvas.height = 0;
        reject(new Error('Image compression timed out'));
      }, 5000);

      // Convert canvas to blob
      canvas.toBlob(
        (blob) => {
          clearTimeout(blobTimeout);
          // Clear canvas to free memory
          canvas.width = 0;
          canvas.height = 0;
          
          if (!blob) {
            reject(new Error('Failed to compress image'));
            return;
          }
          
          // Create new file from blob
          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          
          console.log(`Image compressed: ${(fileSize / 1024).toFixed(0)}KB -> ${(blob.size / 1024).toFixed(0)}KB`);
          
          resolve(compressedFile);
        },
        'image/jpeg',
        targetQuality
      );
    };

    img.onerror = () => {
      clearTimeout(loadTimeout);
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    // Load image from file
    img.src = objectUrl;
  });
}

/**
 * Upload a file to Supabase storage with retry logic
 * Handles flaky Android connections with exponential backoff
 */
export async function uploadWithRetry(
  supabase: any,
  bucket: string,
  fileName: string,
  file: File,
  maxRetries: number = 3
): Promise<{ publicUrl: string }> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Upload attempt ${attempt}/${maxRetries} for ${fileName}`);
      
      // Upload with timeout
      const uploadPromise = supabase.storage.from(bucket).upload(fileName, file);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Upload timed out')), 30000)
      );
      
      const { error: uploadError } = await Promise.race([uploadPromise, timeoutPromise]) as any;
      
      if (uploadError) {
        throw uploadError;
      }
      
      // Get public URL
      const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
      console.log(`Upload successful on attempt ${attempt}`);
      return { publicUrl: data.publicUrl };
      
    } catch (error: any) {
      lastError = error;
      console.error(`Upload attempt ${attempt} failed:`, error.message || error);
      
      // Don't retry on certain errors
      if (error.message?.includes('duplicate') || error.message?.includes('already exists')) {
        throw error;
      }
      
      // Wait before retrying (exponential backoff: 1s, 2s, 4s)
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError || new Error('Upload failed after all retries');
}
