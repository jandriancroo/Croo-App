import type { ReactNode } from 'react';
import { useDuo } from '@/hooks/useDuo';

/**
 * Duo page shell for single-column admin pages: paper/OLED theme tokens, flat open-style cards,
 * content kept clear of Apple's column. On any other device this renders its children untouched.
 * `split` limits the content to the left pane in open mode (when the page docks something on the right).
 */
export function DuoPage({ children, split = false }: { children: ReactNode; split?: boolean }) {
  const duo = useDuo();
  if (!duo.isDuo) return <>{children}</>;
  return <div className={`duo-tasks-page duo-page-flat${split && duo.isOpen ? ' duo-tasks-left' : ''}`}>{children}</div>;
}
