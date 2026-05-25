import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Camera, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhotoPickerButtonProps {
  onFileSelected: (file: File) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  libraryOnly?: boolean;
}

/**
 * Photo picker popover. Uses button + programmatic input.click() (works in
 * normal browsers and Lovable web preview) and renders the popover via a
 * portal to <body> so it escapes any ancestor stacking context.
 */
export function PhotoPickerButton({
  onFileSelected,
  children,
  disabled,
  className,
  libraryOnly,
}: PhotoPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // Outside-tap close (must ignore the portal popover itself)
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  // Position the portal relative to the trigger
  useLayoutEffect(() => {
    if (!open || !wrapperRef.current) return;
    const update = () => {
      const r = wrapperRef.current!.getBoundingClientRect();
      const placeAbove = r.top > 160;
      setPos({
        top: placeAbove ? r.top - 8 : r.bottom + 8,
        left: r.left + r.width / 2,
        placeAbove,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const handleTriggerClick = (e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen((o) => !o);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setOpen(false);
    if (file) onFileSelected(file);
  };

  const pickCamera = () => {
    setOpen(false);
    cameraInputRef.current?.click();
  };

  const pickLibrary = () => {
    setOpen(false);
    libraryInputRef.current?.click();
  };

  return (
    <div ref={wrapperRef} className={cn("relative inline-block", className)}>
      <div onClickCapture={handleTriggerClick}>{children}</div>

      {open && pos &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              transform: pos.placeAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              zIndex: 2147483647,
            }}
          >
            <div
              style={{
                transformOrigin: pos.placeAbove ? "50% 100%" : "50% 0%",
                animation: "ppb-pop 160ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              className="relative min-w-[180px] rounded-xl border bg-popover shadow-2xl"
              role="menu"
            >
              {/* Chat-bubble tail pointing at the trigger */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: "50%",
                  [pos.placeAbove ? "bottom" : "top"]: -6,
                  width: 12,
                  height: 12,
                  transform: "translateX(-50%) rotate(45deg)",
                }}
                className="bg-popover border-r border-b"
                /* When placed below the trigger, flip which borders show so the tail looks like it's emerging upward */
              />
              <div className="relative overflow-hidden rounded-xl">
                {!libraryOnly && (
                  <button
                    type="button"
                    onClick={pickCamera}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent active:bg-accent cursor-pointer text-sm text-popover-foreground select-none text-left"
                    role="menuitem"
                  >
                    <Camera className="h-4 w-4" />
                    Take Photo
                  </button>
                )}
                <button
                  type="button"
                  onClick={pickLibrary}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent active:bg-accent cursor-pointer text-sm text-popover-foreground select-none text-left"
                  role="menuitem"
                >
                  <ImageIcon className="h-4 w-4" />
                  From Library
                </button>
              </div>
            </div>
            <style>{`
              @keyframes ppb-pop {
                0% { opacity: 0; transform: scale(0.9); }
                100% { opacity: 1; transform: scale(1); }
              }
            `}</style>
          </div>,
          document.body,
        )}


      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleChange}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleChange}
      />
    </div>
  );
}


export default PhotoPickerButton;
