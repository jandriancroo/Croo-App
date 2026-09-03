import { useRef, useEffect, useState, useCallback, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { X, Check, RotateCcw, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface LandscapeSignatureOverlayProps {
  open: boolean;
  onClose: () => void;
  onSave: (signatureDataUrl: string) => void;
  title?: string;
  disabled?: boolean;
  /** Optional content rendered ABOVE the signature pad on the same landscape surface. */
  details?: ReactNode;
  /** One-line portrait prompt. */
  rotateMessage?: string;
}

export function LandscapeSignatureOverlay({
  open,
  onClose,
  onSave,
  title = "Sign Below",
  disabled = false,
  details,
  rotateMessage = "Rotate your device to landscape to continue.",
}: LandscapeSignatureOverlayProps) {

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  // Check orientation
  useEffect(() => {
    const checkOrientation = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    window.addEventListener("orientationchange", checkOrientation);
    
    return () => {
      window.removeEventListener("resize", checkOrientation);
      window.removeEventListener("orientationchange", checkOrientation);
    };
  }, []);

  // Resize canvas to match container
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#000000";
    }
  }, []);

  useEffect(() => {
    if (open) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(resizeCanvas, 100);
      window.addEventListener("resize", resizeCanvas);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("resize", resizeCanvas);
      };
    }
  }, [open, resizeCanvas, isLandscape]);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setHasDrawn(false);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx && canvas) {
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      }
    }
  }, [open]);

  const getCoordinates = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  };

  const startDrawing = (e: React.TouchEvent | React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setHasDrawn(false);
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;

    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      {/* Rotate prompt for portrait mode */}
      {!isLandscape && (
        <div className="absolute inset-0 z-10 bg-background flex flex-col items-center justify-center p-6 text-center">
          <Smartphone className="h-16 w-16 text-primary mb-4 animate-pulse" />
          <h2 className="text-xl font-semibold mb-2">Rotate Your Phone</h2>
          <p className="text-muted-foreground mb-6">
            Please rotate your device to landscape mode for the best signing experience.
          </p>
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      )}

      {/* Landscape signature UI */}
      <div className={cn("flex-1 flex flex-col", !isLandscape && "opacity-0 pointer-events-none")}>
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <h2 className="font-medium text-sm">{title}</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={clearCanvas}
              disabled={!hasDrawn || disabled}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!hasDrawn || disabled}
              className="gap-2"
            >
              <Check className="h-4 w-4" />
              Confirm
            </Button>
          </div>
        </div>

        {/* Canvas area */}
        <div className="flex-1 p-4 min-h-0">
          <div
            ref={containerRef}
            className="w-full h-full border-2 border-dashed rounded-lg bg-white dark:bg-slate-900 overflow-hidden relative"
          >
            <canvas
              ref={canvasRef}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              className="touch-none cursor-crosshair w-full h-full"
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-muted-foreground text-lg">Sign here with your finger</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
