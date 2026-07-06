import { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, X } from 'lucide-react';

export interface LightboxItem {
  url: string;
  type: 'image' | 'file' | string;
  name?: string;
}

interface Props {
  items: LightboxItem[];
  index: number | null;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (i: number) => void;
}

function friendlyName(m: LightboxItem) {
  if (m.name) return decodeURIComponent(m.name);
  try { return decodeURIComponent(new URL(m.url).pathname.split('/').pop() || 'Attachment'); }
  catch { return 'Attachment'; }
}

function isPdf(m: LightboxItem) {
  const n = (m.name || m.url).toLowerCase();
  return n.endsWith('.pdf');
}

export function MediaLightbox({ items, index, onOpenChange, onIndexChange }: Props) {
  const open = index != null && items[index] != null;
  const current = open ? items[index!] : null;

  const go = useCallback((delta: number) => {
    if (index == null || items.length === 0) return;
    const next = (index + delta + items.length) % items.length;
    onIndexChange(next);
  }, [index, items.length, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, go]);

  if (!current) return null;

  const name = friendlyName(current);
  const isImage = current.type === 'image';
  const pdf = !isImage && isPdf(current);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent
        className="p-0 border-0 bg-black/95 max-w-[100vw] w-[100vw] h-[100vh] sm:max-w-[100vw] sm:rounded-none flex flex-col gap-0"
        hideClose
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-3 py-2 text-white shrink-0">
          <div className="text-sm truncate max-w-[60%]">{name}</div>
          <div className="flex items-center gap-1">
            <a href={current.url} download target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 h-9 w-9">
                <Download className="h-4 w-4" />
              </Button>
            </a>
            <a href={current.url} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 h-9 w-9">
                <ExternalLink className="h-4 w-4" />
              </Button>
            </a>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 h-9 w-9" onClick={() => onOpenChange(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 relative flex items-center justify-center">
          {items.length > 1 && (
            <button
              type="button"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
              aria-label="Previous"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {isImage ? (
            <img
              src={current.url}
              alt={name}
              className="max-h-full max-w-full object-contain select-none"
              draggable={false}
            />
          ) : pdf ? (
            <iframe src={current.url} title={name} className="w-full h-full bg-white" />
          ) : (
            <div className="text-white flex flex-col items-center gap-3 p-6 text-center">
              <FileText className="h-14 w-14 opacity-80" />
              <div className="text-sm opacity-90 max-w-md break-all">{name}</div>
              <div className="text-xs opacity-70">Preview not available for this file type.</div>
              <a href={current.url} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm">Open file</Button>
              </a>
            </div>
          )}

          {items.length > 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
              aria-label="Next"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>

        {items.length > 1 && (
          <div className="shrink-0 py-2 text-center text-xs text-white/70">
            {index! + 1} / {items.length}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
