import { ROLE_DISPLAY_NAMES, type AppRole } from '@/hooks/useUserRole';

/**
 * Dynamic checklist links ("@mentions").
 *
 * Authors type `@` inside a checklist item and pick a target (recipe, log type,
 * team member, role). The item's text stays human-readable (`@Dough Recipe`)
 * while the structured target is stored separately on `checklist_items.link_refs`.
 * Nothing here writes operational data — chips are navigation/reference only.
 */

export type ChecklistLinkType = 'recipe' | 'log' | 'user' | 'role';

export interface ChecklistLinkRef {
  /** What kind of thing is linked */
  type: ChecklistLinkType;
  /** recipe → library_documents.id, log → logbook_categories.id, user → profiles.id, role → app_role value */
  id: string;
  /** Snapshot of the display name at author time (fallback if the target is renamed/deleted) */
  label: string;
}

export interface MentionCategory {
  /** the word typed after `@` */
  key: string;
  type: ChecklistLinkType;
  label: string;
  /** shown in the picker's empty state */
  placeholder: string;
}

export const MENTION_CATEGORIES: MentionCategory[] = [
  { key: 'recipes', type: 'recipe', label: 'Recipes', placeholder: 'Search recipes…' },
  { key: 'logs', type: 'log', label: 'Logs', placeholder: 'Search log types…' },
  { key: 'user', type: 'user', label: 'Team Member', placeholder: 'Search team…' },
  { key: 'role', type: 'role', label: 'Role', placeholder: 'Search roles…' },
];

/** Roles selectable as a training tag. Mirrors the location-level roles used elsewhere. */
export const MENTIONABLE_ROLES: AppRole[] = [
  'team_member',
  'shift_manager_in_training',
  'shift_manager',
  'manager',
  'admin',
];

export const roleLabel = (role: string) =>
  ROLE_DISPLAY_NAMES[role as AppRole] ?? role;

/** Safely coerce a `link_refs` JSONB value into a typed array. */
export function parseLinkRefs(raw: unknown): ChecklistLinkRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is ChecklistLinkRef =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as any).id === 'string' &&
      typeof (r as any).label === 'string' &&
      MENTION_CATEGORIES.some((c) => c.type === (r as any).type)
  );
}

/** Dedupe by type+id so the same target can't be tagged twice on one item. */
export function addLinkRef(existing: ChecklistLinkRef[], ref: ChecklistLinkRef): ChecklistLinkRef[] {
  if (existing.some((r) => r.type === ref.type && r.id === ref.id)) return existing;
  return [...existing, ref];
}

export function removeLinkRef(existing: ChecklistLinkRef[], ref: ChecklistLinkRef): ChecklistLinkRef[] {
  return existing.filter((r) => !(r.type === ref.type && r.id === ref.id));
}

/**
 * Find an active `@word` fragment immediately before the caret.
 * Returns null when the caret isn't inside a mention.
 */
export function findActiveMention(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  // must be at start of text or preceded by whitespace
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const fragment = upto.slice(at + 1);
  // a mention ends at whitespace — once the author types a space we stop suggesting
  if (/\s/.test(fragment)) return null;
  return { start: at, query: fragment };
}
