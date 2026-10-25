import { Children, cloneElement, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { MapPin, ChevronRight, X, Sparkles, Hand, SlidersHorizontal, LayoutDashboard, MessageSquare, CheckSquare, FileText, Calendar, Package, Users, Settings, Clock, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation } from '@/hooks/useLocation';
import './duo-dash.css';
import { DuoDashContext } from './DuoDashContext';

function emphasizeNumbers(node: ReactNode): ReactNode {
  if (typeof node === 'string') return node.split(/(\$[\d,]+|\d+(?:\.\d+)?%)/g).map((part, i) => /^\$|%$/.test(part) ? <b key={i}>{part}</b> : part);
  if (isValidElement<{ children?: ReactNode }>(node)) return cloneElement(node, {}, emphasizeNumbers(node.props.children));
  return Children.map(node, child => typeof child === 'string' || isValidElement(child) ? emphasizeNumbers(child) : child);
}

export function DuoDash({ sentence, timezone, quickTasks, dashboard, onEdit }: {
  sentence: ReactNode; timezone: string; quickTasks: ReactNode; dashboard: ReactNode; onEdit: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentLocation, isChecklistOnlyLocation } = useLocation();
  const { isAdmin, isShiftManager, isManager, isOrgAdmin, isBrandAdmin, isSuperAdmin, canViewTimecards, loading, role } = useUserRole();
  // Subscribe only to Layout's already-populated profile cache; never fetch.
  const { data: profile } = useQuery<{ full_name?: string; profile_photo_url?: string; nickname?: string }>({
    queryKey: ['user-profile', user?.id], enabled: false,
  });
  const [theme, setTheme] = useState<'paper' | 'oled'>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'oled' : 'paper');
  const [overlay, setOverlay] = useState<'actions' | 'menu' | null>(null);
  const [late, setLate] = useState(0);
  const [chat, setChat] = useState('');
  const { data: inventory } = useQuery<{ configured: boolean }>({ queryKey: ['location-inventory-mode', currentLocation?.id], enabled: false });
  const { data: permissions } = useQuery<Record<string, boolean>>({ queryKey: ['role-permissions', currentLocation?.organization_id, role], enabled: false });
  const hasPermission = (key: string) => permissions?.[key] ?? false;
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      setLate(Number(root.dataset.nudgeLate) || 0);
      // Reuse the badge already rendered by Layout, rather than another unread-count request.
      const link = document.querySelector('nav a[href="/messages"]');
      const badge = link?.querySelector('span');
      setChat(badge?.textContent?.match(/^\d+\+?$/)?.[0] ?? '');
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-nudge-late'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverlay(null); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const fire = (name: string) => {
    setOverlay(null);
    window.dispatchEvent(new CustomEvent(name));
    // Folded Layout already has these actions on existing controls; no shell handler is changed.
    if (!document.documentElement.classList.contains('duo-open')) {
      if (name === 'open-location-picker') document.querySelector<HTMLButtonElement>('[data-tour="location-picker"]')?.click();
      if (name === 'open-nudge') document.querySelector<HTMLButtonElement>('.duo-native-nudge-trigger')?.click();
    }
  };
  const menu = [
    { title: 'Dash', path: '/dashboard', icon: LayoutDashboard },
    { title: 'Chat', path: '/messages', icon: MessageSquare },
    { title: 'Tasks', path: '/tasks', icon: CheckSquare },
    ...(!loading && isShiftManager ? [{ title: 'Logs', path: '/logbook', icon: FileText }] : []),
    ...(!isChecklistOnlyLocation ? [{ title: 'Schedule', path: '/schedule', icon: Calendar }] : []),
    ...(!isChecklistOnlyLocation && (isManager || hasPermission('manage_inventory')) && inventory?.configured ? [{ title: 'Inventory', path: `/inventory/${currentLocation?.id}`, icon: Package }] : []),
    ...(!isChecklistOnlyLocation || isAdmin ? [{ title: isAdmin ? 'Users' : 'My Team', path: isAdmin ? '/users' : '/my-team', icon: Users }] : []),
    ...(!isChecklistOnlyLocation && !loading && (isOrgAdmin || isBrandAdmin || isSuperAdmin || hasPermission('manage_hiring')) ? [{ title: 'Hiring', path: '/hiring', icon: Briefcase }] : []),
    ...(!isChecklistOnlyLocation ? [{ title: 'My Timecard', path: '/my-timecard', icon: Clock }, { title: 'Availability', path: '/availability', icon: Calendar }, ...(canViewTimecards ? [{ title: 'Time Tracking', path: '/time-tracking', icon: Clock }] : [])] : []),
    { title: 'Settings', path: '/settings', icon: Settings },
  ];
  return <div className="duo-dash" data-duo-theme={theme}>
    <div className="duo-dash-grid">
      <div className="duo-dash-intro"><Button variant="ghost" className="duo-date" onClick={() => setTheme(t => t === 'paper' ? 'oled' : 'paper')}>
        {DateTime.now().setZone(timezone).toFormat('cccc, MMM d')}</Button>
        {sentence && <div className="duo-theo"><i aria-hidden /> <div>{emphasizeNumbers(sentence)}</div></div>}
      </div>
      <div className="duo-quick">{quickTasks}</div>
      <div className="duo-widgets"><DuoDashContext.Provider value>{dashboard}</DuoDashContext.Provider></div>
    </div>
    {overlay && <Button variant="ghost" aria-label="Close controls" className="duo-dim" onClick={() => setOverlay(null)} />}
    <Button variant="ghost" className="duo-store duo-glass" onClick={() => fire('open-location-picker')}><MapPin size={17} />{currentLocation?.name}<ChevronRight size={15} /></Button>
    <Button variant="ghost" className="duo-handle duo-glass" aria-label="Open page menu" onClick={() => setOverlay('menu')}><ChevronRight size={13} /></Button>
    {overlay === 'actions' && <div className="duo-actions">{[
      ...(isShiftManager ? [{ label: 'Ask Theo', icon: Sparkles, action: () => fire('open-theo') }] : []),
      ...(isShiftManager ? [{ label: 'Nudge', icon: Hand, action: () => fire('open-nudge') }] : []),
      { label: 'Edit layout', icon: SlidersHorizontal, action: () => { setOverlay(null); onEdit(); } },
    ].map(a => <div key={a.label}><span className="duo-glass">{a.label}</span><Button variant="ghost" className="duo-glass" aria-label={a.label} onClick={a.action}><a.icon size={22} />{a.label === 'Nudge' && late > 0 && <b className="duo-badge">{late}</b>}</Button></div>)}</div>}
    <Button variant="ghost" aria-label={overlay === 'actions' ? 'Close actions' : 'Open Dash actions'} className="duo-orb duo-glass" onClick={() => setOverlay(v => v === 'actions' ? null : 'actions')}>
      {overlay === 'actions' ? <X /> : <><span className="duo-orb-ring" /><i /></>}</Button>
    {overlay === 'menu' && <aside className="duo-menu duo-glass" aria-label="Page menu"><div className="duo-menu-title">CrooHQ <Button variant="ghost" aria-label="Close page menu" onClick={() => setOverlay(null)}><X /></Button></div>
      <div className="duo-menu-items">{menu.map(m => <Button key={m.title} variant="ghost" className={m.title === 'Dash' ? 'duo-selected' : ''} onClick={() => { setOverlay(null); navigate(m.path); }}><m.icon size={21} />{m.title}{m.title === 'Chat' && chat && <b className="duo-badge">{chat}</b>}</Button>)}</div>
      <Button variant="ghost" className="duo-user" onClick={() => navigate('/my-profile')}>{profile?.profile_photo_url && <img src={profile.profile_photo_url} alt="" />}<span><b>{profile?.nickname || profile?.full_name}</b><small>{role?.replace(/_/g, ' ')}</small></span></Button>
    </aside>}
  </div>;
}