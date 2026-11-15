import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';

/** Fallback when layout metrics aren't available (jsdom, first paint). ~3–4 short lines. */
export const REVIEW_TRUNCATE_FALLBACK_CHARS = 180;

/** True when the clamped element overflows, or when we can only use a length heuristic. */
export function reviewTextIsTruncated(
  el: Pick<HTMLElement, 'scrollHeight' | 'clientHeight'> | null,
  text: string,
  fallbackChars = REVIEW_TRUNCATE_FALLBACK_CHARS,
): boolean {
  if (el && el.clientHeight > 0) {
    return el.scrollHeight > el.clientHeight + 1;
  }
  return text.length > fallbackChars;
}

interface ExpandableReviewTextProps {
  text: string;
  reviewId?: string;
  className?: string;
  clampClassName?: string;
  onExpandedChange?: (expanded: boolean) => void;
}

/**
 * Renders customer review text as plain React text (no HTML/markdown parsing)
 * and toggles the line clamp on tap. Shows a "more" label only when the text
 * is actually truncated.
 */
export function ExpandableReviewText({
  text,
  reviewId,
  className,
  clampClassName = 'line-clamp-3',
  onExpandedChange,
}: ExpandableReviewTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    setExpanded(false);
    onExpandedChange?.(false);
  }, [reviewId, text]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the review changes

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const measure = () => {
      // Keep the prior truncated flag while expanded (the clamp is off, so overflow disappears).
      if (expanded) return;
      setTruncated(reviewTextIsTruncated(el, text));
    };

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [text, expanded, clampClassName]);

  const canToggle = truncated || expanded;

  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    if (!canToggle) return;
    setExpanded((prev) => {
      const next = !prev;
      onExpandedChange?.(next);
      return next;
    });
  };

  const body = (
    <>
      <p ref={textRef} className={cn(className, !expanded && clampClassName)}>
        {text}
      </p>
      {canToggle && (
        <span className="mt-0.5 inline-block text-xs sm:text-[10px] font-medium text-primary">
          {expanded ? 'less' : 'more'}
        </span>
      )}
    </>
  );

  if (!canToggle) {
    return <div>{body}</div>;
  }

  return (
    <button
      type="button"
      className="block w-full text-left bg-transparent p-0 border-0 shadow-none appearance-none font-[inherit] text-inherit cursor-pointer"
      onClick={toggle}
      aria-expanded={expanded}
    >
      {body}
    </button>
  );
}
