import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
 * Reusable photo picker. On tap shows a small popover with "Take Photo" and
 * "From Library". Uses real <label htmlFor> elements so the OS file picker /
 * camera opens reliably inside WebViews (Lovable mobile preview, PWA, etc.) —
 * a programmatic `inputRef.click()` would lose the user-gesture token and the
 * camera would silently refuse to open.
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
  const uid = useId().replace(/:/g, "");
  const cameraId = `ppb-cam-${uid}`;
  const libraryId = `ppb-lib-${uid}`;

  // Close on outside tap
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
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
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) setFlipDown(rect.top < 140);
    setOpen((o) => !o);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking same file
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
            <label
              htmlFor={cameraId}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent cursor-pointer text-sm text-popover-foreground select-none"
              role="menuitem"
            >
              <Camera className="h-4 w-4" />
              Take Photo
            </label>
          )}
          <label
            htmlFor={libraryId}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent cursor-pointer text-sm text-popover-foreground select-none"
            role="menuitem"
          >
            <ImageIcon className="h-4 w-4" />
            From Library
          </label>
        </div>
      )}

      {/* Inputs are always mounted so labels can target them even after popover closes */}
      <input
        id={cameraId}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleChange}
      />
      <input
        id={libraryId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleChange}
      />
    </div>
  );
}

export default PhotoPickerButton;
