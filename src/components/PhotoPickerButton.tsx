import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhotoPickerButtonProps {
  onFileSelected: (file: File) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Omit the "Take Photo" option (e.g. desktop-only admin flows). */
  libraryOnly?: boolean;
}

/**
 * Reusable photo picker that, on tap, opens a small popover above the trigger
 * with "Take Photo" (camera) and "From Library" (gallery) options. This works
 * around Android 14+ ignoring `<input accept="image/*">` without `capture` —
 * which routes straight to the gallery and hides the camera.
 */
export function PhotoPickerButton({
  onFileSelected,
  children,
  disabled,
  className,
  libraryOnly,
}: PhotoPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [flipDown, setFlipDown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // Close on outside tap (touch + mouse)
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  const handleTriggerClick = (e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();

    // Decide flip direction based on space above
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceAbove = rect.top;
      setFlipDown(spaceAbove < 140);
    }
    setOpen((o) => !o);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset both so same file can be re-picked
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (libraryInputRef.current) libraryInputRef.current.value = "";
    setOpen(false);
    if (file) onFileSelected(file);
  };

  return (
    <div ref={wrapperRef} className={cn("relative inline-block", className)}>
      <div onClickCapture={handleTriggerClick}>{children}</div>

      {open && (
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 z-50 min-w-[160px] rounded-lg border bg-popover shadow-lg overflow-hidden",
            flipDown ? "top-full mt-2" : "bottom-full mb-2",
          )}
          role="menu"
        >
          {!libraryOnly && (
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent cursor-pointer text-sm text-popover-foreground"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                cameraInputRef.current?.click();
              }}
            >
              <Camera className="h-4 w-4" />
              Take Photo
            </button>
          )}
          <button
            type="button"
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent cursor-pointer text-sm text-popover-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              libraryInputRef.current?.click();
            }}
          >
            <ImageIcon className="h-4 w-4" />
            From Library
          </button>
        </div>
      )}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}

export default PhotoPickerButton;
