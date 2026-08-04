import type { Step } from 'react-joyride';
import type { AppRole } from '@/hooks/useUserRole';

// Role hierarchy helper — returns true if userRole is at or above requiredRole
const ROLE_RANK: Record<string, number> = {
  team_member: 0,
  shift_manager_in_training: 1,
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
  page: string;
  minRole: string;
  placement?: Step['placement'];
  requiresMenu?: boolean; // if true, the mobile menu must be open for this step
  requiresDock?: boolean; // if true, the manager dash must be open for this step
}

// All possible tour steps — filtered at runtime by role
export const ALL_TOUR_STEPS: TourStepDef[] = [
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
    title: 'Data Cubes',
    content: 'Realtime, customizable data organized the way you want. Just tap the "Edit" button on the top right corner of the Dashboard.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'bottom',
  },
  {
    target: '[href="/tasks"], [data-tour="nav-tasks"]',
    title: 'Tasks & Checklists',
    content: 'View and complete assigned tasks and daily checklists. Managers can create tasks and assign them to team members.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  {
    target: '[href="/schedule"], [data-tour="nav-schedule"]',
    title: 'Team Schedule',
    content: 'View your team\'s schedule at a glance. Managers can create, edit, and publish shifts from here.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  {
    target: '[href="/messages"], [data-tour="nav-chat"]',
    title: 'Team Chat',
    content: 'Send messages, create group chats, and make announcements to your team. You\'ll see a badge when you have unread messages.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  {
    target: '[href="/logbook"], [data-tour="nav-logs"]',
    title: 'Manager Logbook',
    content: 'Document important shift notes, incidents, and handoff information for the next manager on duty.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  {
    target: '.mobile-dock-container',
    title: 'Dynamic Manager Dash',
    content: 'Tap to get the "Manager Dash" from the punch clock right on your phone!',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
  },
  {
    target: '[data-tour="theo-orb"]',
    title: 'Meet THEO',
    content: 'This is THEO — your AI co-pilot. Tap the glowing orb anytime in the manager dash to ask about sales, labor, schedule, or anything else.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'bottom',
    requiresDock: true,
  },
  {
    target: '[data-tour="location-picker"]',
    title: 'Switch Locations',
    content: 'If you manage multiple locations, tap here to switch between them. All data updates instantly for the selected location.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'bottom',
  },
  {
    target: '[data-tour="nav-users"]',
    title: 'Team Management',
    content: 'Add new team members, manage roles and permissions, and view employee profiles. Admin access required.',
    page: '/dashboard',
    minRole: 'admin',
    placement: 'top',
    requiresMenu: true,
  },
  {
    target: '[data-tour="nav-settings"]',
    title: 'Settings',
    content: 'Customize your experience — change themes, manage notifications, and configure location-specific settings.',
    page: '/dashboard',
    minRole: 'shift_manager',
    placement: 'top',
    requiresMenu: true,
  },
];

/**
 * Get tour steps filtered by user role.
 * Each returned step includes `data.requiresMenu` so the tour component
 * can open the mobile menu before showing menu-only steps.
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
      data: { requiresMenu: !!step.requiresMenu, requiresDock: !!step.requiresDock },
    }));
}
