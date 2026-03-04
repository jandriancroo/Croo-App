import type React from 'react';
import { forwardRef } from 'react';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Improved scroller for react-virtuoso on mobile.
 * - overscrollBehaviorY: 'none' prevents iOS rubber-banding from interfering
 * - touchAction: 'pan-y pinch-zoom' restricts to vertical scroll + zoom
 * - WebkitOverflowScrolling: 'touch' enables native momentum on iOS
 */
export const VirtuosoPanYScroller = forwardRef<HTMLDivElement, DivProps>(
  function VirtuosoPanYScroller({ style, ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        style={{
          ...style,
          overscrollBehaviorY: 'none',
          touchAction: 'pan-y pinch-zoom',
          WebkitOverflowScrolling: 'touch',
        }}
      />
    );
  }
);
