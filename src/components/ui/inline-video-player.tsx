import { useMemo, useState } from 'react';
import { Play, Video, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Converts a share link into an in-app embeddable URL.
 * Supports YouTube, YouTube Shorts, Vimeo, Loom and direct video files.
 * Returns null when the link can't be embedded (open externally instead).
 */
export function toEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());

    if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return u.toString();

    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube-nocookie.com/embed/${v}?playsinline=1&rel=0`;
      const shorts = u.pathname.match(/\/shorts\/([\w-]+)/);
      if (shorts) return `https://www.youtube-nocookie.com/embed/${shorts[1]}?playsinline=1&rel=0`;
      const embed = u.pathname.match(/\/embed\/([\w-]+)/);
      if (embed) return `https://www.youtube-nocookie.com/embed/${embed[1]}?playsinline=1&rel=0`;
    }

    if (u.hostname === 'youtu.be' || u.hostname === 'www.youtu.be') {
      const id = u.pathname.slice(1);
      if (id) return `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0`;
    }

    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop();
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}?playsinline=1`;
    }

    if (u.hostname.includes('loom.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop();
      if (id) return `https://www.loom.com/embed/${id}`;
    }
  } catch {
    return null;
  }
  return null;
}

const isFileUrl = (url: string) => /\.(mp4|webm|mov|m4v)($|\?)/i.test(url);

interface Props {
  url: string;
  title?: string;
  className?: string;
  /** Show a tap-to-play poster first (keeps mobile lists light) */
  lazy?: boolean;
}

/**
 * Inline video player — keeps playback inside the app instead of handing off
 * to the YouTube app or Safari. Falls back to an external link when a URL
 * can't be embedded.
 */
export function InlineVideoPlayer({ url, title = 'Reference video', className, lazy = true }: Props) {
  const embedUrl = useMemo(() => toEmbedUrl(url), [url]);
  const [active, setActive] = useState(!lazy);

  if (!embedUrl) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-primary hover:underline inline-flex items-center gap-1 break-all"
      >
        <ExternalLink className="h-3 w-3 shrink-0" />
        Open video
      </a>
    );
  }

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => setActive(true)}
        className={cn(
          'relative w-full aspect-video rounded-lg overflow-hidden bg-muted flex items-center justify-center group',
          className
        )}
        aria-label={`Play ${title}`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-foreground/10 to-foreground/25" />
        <div className="relative flex flex-col items-center gap-1.5">
          <span className="h-11 w-11 rounded-full bg-background/90 flex items-center justify-center shadow-sm group-active:scale-95 transition-transform">
            <Play className="h-5 w-5 text-primary ml-0.5" fill="currentColor" />
          </span>
          <span className="text-[11px] font-medium text-foreground/80 flex items-center gap-1">
            <Video className="h-3 w-3" /> Tap to play
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className={cn('relative w-full aspect-video rounded-lg overflow-hidden bg-black', className)}>
      {isFileUrl(embedUrl) ? (
        <video
          src={embedUrl}
          controls
          autoPlay={lazy}
          playsInline
          className="absolute inset-0 w-full h-full"
        />
      ) : (
        <iframe
          src={lazy ? `${embedUrl}${embedUrl.includes('?') ? '&' : '?'}autoplay=1` : embedUrl}
          title={title}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      )}
    </div>
  );
}
