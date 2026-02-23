import type React from 'react';
import { forwardRef } from 'react';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Prevents iOS Safari from allowing a small horizontal "drag" while vertically scrolling.
 * Used as react-virtuoso Scroller component.
 */
export const VirtuosoPanYScroller = forwardRef<HTMLDivElement, DivProps>(
  function VirtuosoPanYScroller({ style, ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        data-scroll-lock-scrollable=""
        style={{
          ...style,
          height: '100%',
          overflowX: 'hidden',
          overflowY: 'auto',
          touchAction: 'pan-y',
          overscrollBehaviorX: 'none',
          overscrollBehaviorY: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      />
    );
  }
);
