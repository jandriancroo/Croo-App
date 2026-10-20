import { describe, it, expect } from 'vitest';
import { gateRecipient, defaultFromHome } from '../../supabase/functions/_shared/notificationGate';

describe('notification gate (enabled + From home)', () => {
  it('locked about-you types always send, even if turned off and off the clock', () => {
    expect(gateRecipient({ type: 'schedule_updates', role: 'team_member', userPush: false, userFromHome: false, clockedIn: false }).send).toBe(true);
    expect(gateRecipient({ type: 'shift_reminders', role: 'team_member', roleEnabled: false, clockedIn: false }).send).toBe(true);
    expect(gateRecipient({ type: 'certificate_expiry', role: 'team_member', userPush: false, clockedIn: false }).send).toBe(true);
  });

  it('chat defaults on, from home, for every role; user can turn it off', () => {
    expect(gateRecipient({ type: 'chat_messages', role: 'team_member', clockedIn: false }).send).toBe(true);
    expect(gateRecipient({ type: 'chat_messages', role: 'team_member', userPush: false, clockedIn: true }).send).toBe(false);
    expect(gateRecipient({ type: 'chat_messages', role: 'manager', userFromHome: false, clockedIn: false }).send).toBe(false);
  });

  it('shift managers get store-status only while clocked in by default', () => {
    expect(defaultFromHome('shift_manager', 'overdue_checklists')).toBe(false);
    expect(defaultFromHome('shift_manager_in_training', 'toast_late_clock_in')).toBe(false);
    expect(gateRecipient({ type: 'overdue_checklist', role: 'shift_manager', clockedIn: false }).send).toBe(false);
    expect(gateRecipient({ type: 'overdue_checklist', role: 'shift_manager', clockedIn: true }).send).toBe(true);
    expect(gateRecipient({ type: 'overdue_checklist', role: 'shift_manager', userFromHome: true, clockedIn: false }).send).toBe(true);
  });

  it('managers and up get store-status from home by default', () => {
    expect(gateRecipient({ type: 'late_arrival', role: 'manager', clockedIn: false }).send).toBe(true);
    expect(gateRecipient({ type: 'shift_overstay', role: 'org_admin', clockedIn: false }).send).toBe(true);
  });

  it('sales pulses never go to team members without view_sales', () => {
    expect(gateRecipient({ type: 'hourly_sales_pulse', role: 'team_member', userPush: true, userFromHome: true, clockedIn: true, teamMemberViewSales: false }).send).toBe(false);
    expect(gateRecipient({ type: 'day_part_pulse', role: 'team_member', clockedIn: true, teamMemberViewSales: true }).send).toBe(true);
    expect(gateRecipient({ type: 'day_part_pulse', role: 'team_member', clockedIn: false, teamMemberViewSales: true }).send).toBe(false);
  });

  it('missing store skips only the clock check', () => {
    expect(gateRecipient({ type: 'overdue_checklists', role: 'shift_manager', clockedIn: null }).send).toBe(true);
    expect(gateRecipient({ type: 'overdue_checklists', role: 'shift_manager', roleEnabled: false, clockedIn: null }).send).toBe(false);
  });
});
