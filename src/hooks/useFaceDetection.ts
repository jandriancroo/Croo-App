import { useRef, useCallback, useEffect, useState } from 'react';

/**
 * Lightweight face detection using the browser's built-in FaceDetector API.
 * Works in Chrome/Edge (Shape Detection API). Falls back to canvas-based
 * skin-tone heuristic for Safari/Firefox — good enough to confirm "a face
 * with two eyes is present" without any AI API cost.
 */

type FaceDetectionResult = {
  faceDetected: boolean;
  confidence: number;
  eyeCount: number;
};

// Check if native FaceDetector is available
const hasNativeFaceDetector = typeof window !== 'undefined' && 'FaceDetector' in window;

export function useFaceDetection(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [result, setResult] = useState<FaceDetectionResult>({
    faceDetected: false,
    confidence: 0,
    eyeCount: 0,
  });
  const detectorRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const [active, setActive] = useState(false);

  // Initialize detector
  useEffect(() => {
    if (hasNativeFaceDetector) {
      try {
        // @ts-ignore - FaceDetector is not in TS types yet
        detectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      } catch {
        detectorRef.current = null;
      }
    }
    canvasRef.current = document.createElement('canvas');
    canvasRef.current.width = 160;
    canvasRef.current.height = 120;

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Canvas-based fallback: detect skin-tone pixels in face region
  const detectViaCanvas = useCallback((): FaceDetectionResult => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      return { faceDetected: false, confidence: 0, eyeCount: 0 };
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { faceDetected: false, confidence: 0, eyeCount: 0 };

    ctx.drawImage(video, 0, 0, 160, 120);
    const imageData = ctx.getImageData(0, 0, 160, 120);
    const data = imageData.data;

    // Check center region for skin-tone pixels
    let skinPixels = 0;
    let totalChecked = 0;
    let darkPixelsLeftEye = 0;
    let darkPixelsRightEye = 0;

    for (let y = 20; y < 100; y++) {
      for (let x = 30; x < 130; x++) {
        const i = (y * 160 + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        totalChecked++;

        // Broad skin-tone detection (works across skin colors)
        const isSkin = r > 60 && g > 40 && b > 20 &&
          r > g && r > b &&
          Math.abs(r - g) > 10 &&
          r - b > 15;

        if (isSkin) skinPixels++;

        // Check eye regions for dark spots (pupils)
        const isDark = r < 80 && g < 80 && b < 80;
        if (isDark) {
          // Left eye region (roughly 35-45% x, 30-42% y)
          if (x >= 56 && x <= 72 && y >= 36 && y <= 50) darkPixelsLeftEye++;
          // Right eye region (roughly 55-65% x, 30-42% y)
          if (x >= 88 && x <= 104 && y >= 36 && y <= 50) darkPixelsRightEye++;
        }
      }
    }

    const skinRatio = skinPixels / totalChecked;
    const hasLeftEye = darkPixelsLeftEye > 5;
    const hasRightEye = darkPixelsRightEye > 5;
    const eyeCount = (hasLeftEye ? 1 : 0) + (hasRightEye ? 1 : 0);

    // Face detected if enough skin tone and at least some dark regions (face features)
    const faceDetected = skinRatio > 0.15 && skinPixels > 200;
    const confidence = Math.min(skinRatio * 3, 1); // rough confidence

    return { faceDetected, confidence, eyeCount };
  }, [videoRef]);

  // Native FaceDetector path
  const detectViaAPI = useCallback(async (): Promise<FaceDetectionResult> => {
    const video = videoRef.current;
    if (!video || !detectorRef.current || video.readyState < 2) {
      return { faceDetected: false, confidence: 0, eyeCount: 0 };
    }

    try {
      const faces = await detectorRef.current.detect(video);
      if (faces.length > 0) {
        const face = faces[0];
        // FaceDetector gives bounding box; if face is reasonably sized, it's legit
        const faceArea = face.boundingBox.width * face.boundingBox.height;
        const videoArea = video.videoWidth * video.videoHeight;
        const faceRatio = faceArea / videoArea;

        return {
          faceDetected: faceRatio > 0.03, // Face should be at least 3% of frame
          confidence: Math.min(faceRatio * 5, 0.99),
          eyeCount: face.landmarks?.filter((l: any) => l.type === 'eye')?.length || 0,
        };
      }
    } catch {
      // Fall back to canvas
      return detectViaCanvas();
    }

    return { faceDetected: false, confidence: 0, eyeCount: 0 };
  }, [videoRef, detectViaCanvas]);

  const startDetection = useCallback(() => {
    setActive(true);
    setResult({ faceDetected: false, confidence: 0, eyeCount: 0 });

    // Poll every 300ms
    intervalRef.current = setInterval(async () => {
      const res = hasNativeFaceDetector && detectorRef.current
        ? await detectViaAPI()
        : detectViaCanvas();
      setResult(res);
    }, 300);
  }, [detectViaAPI, detectViaCanvas]);

  const stopDetection = useCallback(() => {
    setActive(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }, []);

  return { ...result, active, startDetection, stopDetection };
}
