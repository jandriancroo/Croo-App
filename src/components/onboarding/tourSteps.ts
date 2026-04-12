import type { Step } from 'react-joyride';
import type { AppRole } from '@/hooks/useUserRole';

// Role hierarchy helper — returns true if userRole is at or above requiredRole
const ROLE_RANK: Record<string, number> = {
  team_member: 0,
  shift_manager: 1,
  manager: 2,
  admin: 3,
  org_admin: 4,
  brand_admin: 5,
  super_admin: 6,
};

function isRoleAtLeast(userRole: AppRole | null, required: string): boolean {
  if (!userRole) return false;
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[required] ?? 0);
}

interface TourStepDef {
  target: string;
  title: string;
  content: string;
  page: string; // which route this step lives on
  minRole: string; // minimum role to see this step
  placement?: Step['placement'];
}

// All possible tour steps — filtered at runtime by role
export const ALL_TOUR_STEPS: TourStepDef[] = [
  // ─── Dashboard ───
  {
    target: '.dock-nav-button',
    title: 'Navigation Dock',
    content: 'This is your main navigation. Tap any icon to jump between sections — Dashboard, Chat, Tasks, Logs, and Schedule.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  {
    target: '[data-tour="dashboard-cubes"]',
    title: 'Dashboard Overview',
    content: 'Your dashboard shows real-time metrics — sales, labor, tasks due, and more. Tap any cube for details. Long-press to rearrange them.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'bottom',
  },
  // ─── Tasks ───
  {
    target: '[href="/tasks"], [data-tour="nav-tasks"]',
    title: 'Tasks & Checklists',
    content: 'View and complete assigned tasks and daily checklists. Managers can create tasks and assign them to team members.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  // ─── Schedule ───
  {
    target: '[href="/schedule"], [data-tour="nav-schedule"]',
    title: 'Team Schedule',
    content: 'View your team\'s schedule at a glance. Managers can create, edit, and publish shifts from here.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  // ─── Chat ───
  {
    target: '[href="/messages"], [data-tour="nav-chat"]',
    title: 'Team Chat',
    content: 'Send messages, create group chats, and make announcements to your team. You\'ll see a badge when you have unread messages.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  // ─── Logbook ───
  {
    target: '[href="/logbook"], [data-tour="nav-logs"]',
    title: 'Manager Logbook',
    content: 'Document important shift notes, incidents, and handoff information for the next manager on duty.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  // ─── Mobile menu (hamburger / avatar) ───
  {
    target: '.mobile-dock-container',
    title: 'Quick Access Menu',
    content: 'Tap your profile avatar in the header for quick access to Time Tracking, Inventory, Users, Settings, and more.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  // ─── Location picker ───
  {
    target: '[data-tour="location-picker"]',
    title: 'Switch Locations',
    content: 'If you manage multiple locations, tap here to switch between them. All data updates instantly for the selected location.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'bottom',
  },
  // ─── Inventory (manager+) ───
  {
    target: '[data-tour="nav-inventory"]',
    title: 'Inventory Management',
    content: 'Count inventory with voice commands or manual entry. Track usage, set par levels, and sync with vendors.',
    page: '/dashboard',
    minRole: 'manager',
    placement: 'top',
  },
  // ─── Users (admin+) ───
  {
    target: '[data-tour="nav-users"]',
    title: 'Team Management',
    content: 'Add new team members, manage roles and permissions, and view employee profiles. Admin access required.',
    page: '/dashboard',
    minRole: 'admin',
    placement: 'top',
  },
  // ─── Settings ───
  {
    target: '[data-tour="nav-settings"]',
    title: 'Settings',
    content: 'Customize your experience — change themes, manage notifications, and configure location-specific settings.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
];

/**
 * Get tour steps filtered by user role
 */
export function getTourStepsForRole(role: AppRole | null): Step[] {
  return ALL_TOUR_STEPS
    .filter(step => isRoleAtLeast(role, step.minRole))
    .map(step => ({
      target: step.target,
      title: step.title,
      content: step.content,
      placement: step.placement || 'auto',
      disableBeacon: true,
      spotlightClicks: false,
    }));
}
