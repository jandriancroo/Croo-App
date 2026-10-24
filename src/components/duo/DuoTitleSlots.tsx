import { createContext } from 'react';

/** Layout-owned destinations; null outside open Duo. No page data is copied. */
export const DuoTitleSlotsContext = createContext<{
  left: HTMLDivElement | null;
  right: HTMLDivElement | null;
}>({ left: null, right: null });