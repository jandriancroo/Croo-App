import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2 } from 'lucide-react';

interface PostActionsPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}

export function PostActionsPopover({
  open,
  onOpenChange,
  triggerRef,
  onEdit,
  onDelete,
  canEdit,
}: PostActionsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open, onOpenChange, triggerRef]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const placeAbove = r.top > 140;
      setPos({
        top: placeAbove ? r.top - 8 : r.bottom + 8,
        left: r.left + r.width / 2,
        placeAbove,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, triggerRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        transform: pos.placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        zIndex: 2147483647,
      }}
    >
      <div
        style={{
          transformOrigin: pos.placeAbove ? '50% 100%' : '50% 0%',
          animation: 'ppb-pop 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="relative min-w-[180px] rounded-xl border bg-popover shadow-2xl"
        role="menu"
      >
        {/* Chat-bubble tail pointing at the trigger */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            [pos.placeAbove ? 'bottom' : 'top']: -6,
            width: 12,
            height: 12,
            transform: 'translateX(-50%) rotate(45deg)',
          }}
          className="bg-popover border-r border-b"
        />
        <div className="relative overflow-hidden rounded-xl">
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onEdit();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent active:bg-accent cursor-pointer text-sm text-popover-foreground select-none text-left"
              role="menuitem"
            >
              <Pencil className="h-4 w-4" />
              Edit post
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onDelete();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent active:bg-accent cursor-pointer text-sm text-destructive select-none text-left"
            role="menuitem"
          >
            <Trash2 className="h-4 w-4" />
            Delete post
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
  );
}
