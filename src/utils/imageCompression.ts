/**
 * Compress and resize an image file to reduce memory usage
 * Optimized for low-memory Android devices like Samsung Galaxy A14
 */
export async function compressImage(
  file: File,
  maxWidth: number = 800,
  maxHeight: number = 800,
  quality: number = 0.6
): Promise<File> {
  return new Promise((resolve, reject) => {
    // For very large files, use even more aggressive compression
    const fileSize = file.size;
    const isLargeFile = fileSize > 3 * 1024 * 1024; // > 3MB
    
    const targetMaxWidth = isLargeFile ? 600 : maxWidth;
    const targetMaxHeight = isLargeFile ? 600 : maxHeight;
    const targetQuality = isLargeFile ? 0.5 : quality;

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
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

      // Convert canvas to blob
      canvas.toBlob(
        (blob) => {
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
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    // Load image from file
    img.src = objectUrl;
  });
}
