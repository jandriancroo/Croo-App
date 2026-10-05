import { describe, it, expect } from 'vitest';
import { highestRole, actionsFor, CREATE_EVENT_ROLES, CREATE_TASK_ROLES, PUNCH_ROLES, COVER_SHIFT_ROLES, ADD_SHIFT_ROLES, DELETE_SHIFT_ROLES, SWAP_SHIFT_ROLES, CHANGE_SHIFT_ROLES } from '../../supabase/functions/_shared/theoActions';

// Same list ai-assistant uses to let people ask Theo questions (unchanged).
const THEO_QUESTION_ROLES = ['shift_manager', 'shift_manager_in_training', 'manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin'];
const allowed = (rows: string[]) => { const r = highestRole(rows); return !!r && THEO_QUESTION_ROLES.includes(r); };

describe('highestRole', () => {
  it('team_member + manager -> manager', () => expect(highestRole(['team_member', 'manager'])).toBe('manager'));
  it('org_admin + team_member -> org_admin', () => expect(highestRole(['org_admin', 'team_member'])).toBe('org_admin'));
  it('team_member + shift_manager -> shift_manager', () => expect(highestRole(['team_member', 'shift_manager'])).toBe('shift_manager'));
  it('team_member alone -> team_member, still refused', () => {
    expect(highestRole(['team_member'])).toBe('team_member');
    expect(allowed(['team_member'])).toBe(false);
  });
  it('no rows -> refused', () => {
    expect(highestRole([])).toBeNull();
    expect(allowed([])).toBe(false);
  });
  it('multi-role managers are allowed', () => expect(allowed(['team_member', 'manager'])).toBe(true));
});

describe('actionsFor (role x action)', () => {
  const table: [string, boolean, boolean][] = [ // [role, create_task + create_event, shift actions]
    ['team_member', false, false],
    ['shift_manager_in_training', false, false],
    ['shift_manager', false, false],
    ['manager', true, true],
    ['admin', true, true],
    ['org_admin', true, true],
    ['brand_admin', false, false],
    ['super_admin', true, true],
  ];
  for (const [role, task, cover] of table) {
    it(`${role}: create_task ${task}, create_event ${task}, cover/add/delete/swap/change shift ${cover}`, () => expect(actionsFor(role, true)).toEqual({ create_task: task, cover_shift: cover, add_shift: cover, delete_shift: cover, swap_shift: cover, change_shift: cover, create_event: task, send_message: task, clock_punch: task }));
  }
  it('no store access -> nothing, even super admin', () => expect(actionsFor('super_admin', false)).toEqual({ create_task: false, cover_shift: false, add_shift: false, delete_shift: false, swap_shift: false, change_shift: false, create_event: false, send_message: false, clock_punch: false }));
  it('CREATE_EVENT_ROLES is the CREATE_TASK_ROLES list', () => expect(CREATE_EVENT_ROLES).toBe(CREATE_TASK_ROLES));
  it('PUNCH_ROLES is the CREATE_TASK_ROLES list', () => expect(PUNCH_ROLES).toBe(CREATE_TASK_ROLES));
  it('every schedule switch is the CREATE_TASK_ROLES list', () => { for (const l of [COVER_SHIFT_ROLES, ADD_SHIFT_ROLES, DELETE_SHIFT_ROLES, SWAP_SHIFT_ROLES, CHANGE_SHIFT_ROLES]) expect(l).toBe(CREATE_TASK_ROLES); });
  it('team_member + manager uses manager', () => expect(actionsFor(highestRole(['team_member', 'manager']), true).create_task).toBe(true));
});
