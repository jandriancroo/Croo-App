import { useSyncExternalStore } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Orb actions a page registers while mounted (Duo only). DuoNav merges them into the fan. */
export interface DuoPageAction {
  label: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
  disabled?: boolean;
}

let current: DuoPageAction[] = [];
let owner: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export function setDuoPageActions(id: string, actions: DuoPageAction[]) {
  owner = id;
  current = actions;
  emit();
}
export function clearDuoPageActions(id: string) {
  if (owner !== id) return;
  owner = null;
  current = [];
  emit();
}
export function useDuoPageActions(): DuoPageAction[] {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => current,
    () => current,
  );
}
