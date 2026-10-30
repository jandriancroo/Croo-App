import { useEffect, useRef, useState } from 'react';
import { useLocation as useRouterLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TheoOrb } from '@/components/dock/TheoOrb';
import { DuoOvation } from '@/components/duo/DuoOvation';
import { useDuoPageActions } from '@/lib/duoPageActions';
import { useDuoTheme, setDuoThemeMode, type DuoThemeMode } from '@/lib/duoTheme';
import { useOvationData } from '@/components/dashboard/OvationScorePopover';
import { Pencil, Mail, Inbox, ChevronRight, MapPin, X, Sparkles, Hand, SlidersHorizontal, LayoutDashboard, MessageSquare, CheckSquare, FileText, Calendar, Package, Users, Settings, Briefcase, Clock, Gauge, Zap, ClipboardList, FileText as FileTextIcon, Copy, Plus, BookOpen, Upload, UserPlus, RefreshCw, FlaskConical, Save, Award, ListChecks, Sun, Moon, SunMoon, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation } from '@/hooks/useLocation';
import './duo-dash.css';

/** Duo-only left-edge slide-out navigation. Rendered by Layout on every Duo page. */
export function DuoNav({ brandLogo, brandName }: { brandLogo?: string | null; brandName?: string | null }) {
  const navigate = useNavigate();
  const route = useRouterLocation();
  const { user } = useAuth();
  const { currentLocation, isChecklistOnlyLocation } = useLocation();
  const { isAdmin, isShiftManager, isManager, isOrgAdmin, isBrandAdmin, isSuperAdmin, canViewTimecards, loading, role } = useUserRole();
  const { data: profile } = useQuery<{ full_name?: string; profile_photo_url?: string; nickname?: string }>({
    queryKey: ['user-profile', user?.id], enabled: false,
  });
  const { data: inventory } = useQuery<{ configured: boolean }>({ queryKey: ['location-inventory-mode', currentLocation?.id], enabled: false });
  const { data: permissions } = useQuery<Record<string, boolean>>({ queryKey: ['role-permissions', currentLocation?.organization_id, role], enabled: false });
  const hasPermission = (key: string) => permissions?.[key] ?? false;
  const [open, setOpen] = useState(false);
  const [fan, setFan] = useState(false);
  const pageActions = useDuoPageActions();
  const [bump, setBump] = useState(0);
  const [ovOpen, setOvOpen] = useState(false);
  const [ovTop, setOvTop] = useState(120);
  const [late, setLate] = useState(0);
  const [chat, setChat] = useState('');
  const { mode: themeMode, theme } = useDuoTheme();
  const [timeOpen, setTimeOpen] = useState(false);
  useEffect(() => {
    const update = () => {
      const badge = document.querySelector('nav a[href="/messages"]')?.querySelector('span');
      setChat(badge?.textContent?.match(/^\d+\+?$/)?.[0] ?? '');
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setOpen(false); setFan(false); setOvOpen(false); }, [route.pathname]);
  useEffect(() => { if (!open) setOvOpen(false); }, [open]);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setLate(Number(root.dataset.nudgeLate) || 0);
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-nudge-late'] });
    return () => observer.disconnect();
  }, []);
  // Theo orb: tap = actions menu, long press = fly to center and open Theo's full-screen voice mode.
  const [fly, setFly] = useState(false);
  const [hint, setHint] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const [pageNote, setPageNote] = useState('');
  const [pageTitleName, setPageTitleName] = useState('');
  const [libTab, setLibTab] = useState(false);
  const [libEdit, setLibEdit] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => { setPageNote(root.dataset.duoStatus || ''); setPageTitleName(root.dataset.duoPage || ''); setLibTab(root.dataset.duoTab === 'library'); setLibEdit(!!root.dataset.duoLibEdit); };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-duo-status', 'data-duo-tab', 'data-duo-lib-edit', 'data-duo-page'] });
    return () => observer.disconnect();
  }, []);
  const menu = [
    { title: 'Dash', path: '/dashboard', icon: LayoutDashboard },
    { title: 'Chat', path: '/messages', icon: MessageSquare },
    { title: 'Tasks', path: '/tasks', icon: CheckSquare },
    ...(!loading && isShiftManager ? [{ title: 'Logs', path: '/logbook', icon: FileText }] : []),
    ...(!isChecklistOnlyLocation ? [{ title: 'Schedule', path: '/schedule', icon: Calendar }] : []),
    ...(!isChecklistOnlyLocation && (isManager || hasPermission('manage_inventory')) && inventory?.configured ? [{ title: 'Inventory', path: `/inventory/${currentLocation?.id}`, icon: Package }] : []),
    ...(!isChecklistOnlyLocation || isAdmin ? [{ title: isAdmin ? 'Users' : 'My Team', path: isAdmin ? '/users' : '/my-team', icon: Users }] : []),
    ...(!isChecklistOnlyLocation && !loading && (isOrgAdmin || isBrandAdmin || isSuperAdmin || hasPermission('manage_hiring')) ? [{ title: 'Hiring', path: '/hiring', icon: Briefcase }] : []),
  ];
  const timeItems = !isChecklistOnlyLocation ? [{ title: 'My Timecard', path: '/my-timecard', icon: Clock }, { title: 'Availability', path: '/availability', icon: Calendar }, ...(canViewTimecards ? [{ title: 'Time Tracking', path: '/time-tracking', icon: Clock }] : [])] : [];
  const openLocation = () => {
    window.dispatchEvent(new CustomEvent('open-location-picker'));
    // Folded Layout already has this action on its existing control.
    if (!document.documentElement.classList.contains('duo-open')) document.querySelector<HTMLButtonElement>('[data-tour="location-picker"]')?.click();
  };
  const fire = (name: string) => {
    setFan(false);
    window.dispatchEvent(new CustomEvent(name));
    // Folded Layout already has the Nudge action on an existing control.
    if (name === 'open-nudge' && !document.documentElement.classList.contains('duo-open')) document.querySelector<HTMLButtonElement>('.duo-native-nudge-trigger')?.click();
  };
  const onChat = route.pathname.startsWith('/messages');
  const onDash = route.pathname === '/dashboard' || route.pathname === '/';
  const onChecklist = /^\/(complete-checklist|edit-checklist|create-checklist|dynamic-checklist|testing-checklist)/.test(route.pathname);
  const active = (path: string) => path === '/dashboard' ? (route.pathname === '/dashboard' || route.pathname === '/') : (route.pathname.startsWith(path) || (path === '/tasks' && onChecklist));
  const timeActive = timeItems.some(t => active(t.path));
  useEffect(() => { if (timeActive) setTimeOpen(true); }, [timeActive]);
  const pageName = menu.find(m => active(m.path))?.title || pageTitleName;
  const onTasks = route.pathname.startsWith('/tasks');
  const onLogs = route.pathname.startsWith('/logbook');
  const onUsers = route.pathname.startsWith('/users');
  const onProfile = route.pathname.startsWith('/my-profile');
  const onLocationEdit = /^\/location\/[^/]+$/.test(route.pathname);
  const onOrgEdit = /^\/organization\/[^/]+$/.test(route.pathname);
  const pageStatus = onChat ? (chat ? `${chat} unread` : 'All caught up') : pageNote;
  const ovation = useOvationData().displayScore;
  const showOvation = (isManager || hasPermission('view_ovation_reviews')) && !!ovation;
  const canTalk = !loading && isShiftManager;
  useEffect(() => {
    if (!canTalk) return;
    try { if (localStorage.getItem('duo-orb-hint')) return; localStorage.setItem('duo-orb-hint', '1'); } catch { return; }
    const a = window.setTimeout(() => setHint(true), 1500);
    const b = window.setTimeout(() => setHint(false), 7500);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [canTalk]);
  const holdStart = () => {
    held.current = false;
    if (!canTalk) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      setHint(false); setFan(false); setFly(true);
      try { navigator.vibrate?.(15); } catch { /* not supported */ }
      // Theo's own voice orb grows out of the corner (CSS, html.duo-theo-launch); this orb just fades.
      const root = document.documentElement;
      root.classList.add('duo-theo-launch');
      window.dispatchEvent(new CustomEvent('open-theo-voice'));
      window.setTimeout(() => { root.classList.remove('duo-theo-launch'); setFly(false); }, 1000);
    }, 450);
  };
  const holdCancel = () => window.clearTimeout(holdTimer.current);
  const baseActions: { label: string; icon: any; action: () => void; disabled?: boolean }[] = [

      ...(onChat ? [{ label: 'New post', icon: Pencil, action: () => fire('open-new-post') }, { label: 'New DM', icon: Mail, action: () => fire('open-new-dm') }, ...(!document.documentElement.classList.contains('duo-open') ? [{ label: 'Inbox', icon: Inbox, action: () => fire('open-inbox') }] : [])] : []),
      ...(onDash && isShiftManager ? [{ label: 'Ask Theo', icon: Sparkles, action: () => fire('open-theo-voice') }] : []),
      ...(onDash && isShiftManager ? [{ label: 'Manager dash', icon: Gauge, action: () => fire('open-manager-dash') }] : []),
      ...(onDash && isShiftManager ? [{ label: 'Nudge', icon: Hand, action: () => fire('open-nudge') }] : []),
      ...(onTasks && (isAdmin || isManager) ? [{ label: 'New Quick Task', icon: Zap, action: () => fire('open-new-quick-task') }] : []),
      ...(onTasks && (isAdmin || isManager) ? [{ label: 'Templates', icon: FileTextIcon, action: () => fire('open-quick-task-templates') }] : []),
      ...(onTasks && isAdmin ? [{ label: 'New Checklist', icon: ClipboardList, action: () => fire('open-new-checklist') }, { label: 'Copy All', icon: Copy, action: () => fire('open-copy-all-checklists') }] : []),
      ...(onLogs && libTab && libEdit ? [{ label: 'New recipe', icon: BookOpen, action: () => fire('open-new-recipe') }, { label: 'Upload document', icon: Upload, action: () => fire('open-upload-document') }] : []),
      ...(onLogs && !libTab && isShiftManager ? [{ label: 'New log', icon: Plus, action: () => fire('open-new-log') }] : []),
      ...(onLogs && isAdmin ? [{ label: 'Manage categories', icon: Settings, action: () => fire('open-manage-categories') }] : []),
      ...(onUsers && isAdmin ? [{ label: 'Invite user', icon: UserPlus, action: () => fire('open-invite-user') }, { label: 'Select users', icon: ListChecks, action: () => fire('users-bulk-select') }, { label: 'Update outdated', icon: RefreshCw, action: () => fire('users-update-outdated') }] : []),
      ...(onUsers && isAdmin && currentLocation?.name?.toLowerCase() === 'hemet' ? [{ label: 'Add test employee', icon: FlaskConical, action: () => fire('users-test-employee') }] : []),
      ...(onUsers ? [{ label: 'Certifications', icon: Award, action: () => { setFan(false); navigate('/certifications'); } }] : []),
      ...(onLocationEdit ? [{ label: 'Save settings', icon: Save, action: () => fire('location-save') }] : []),
      ...(onOrgEdit ? [{ label: 'Save settings', icon: Save, action: () => fire('org-save') }, { label: 'Add location', icon: Plus, action: () => fire('org-add-location') }] : []),
      ...(onProfile ? [{ label: 'Save changes', icon: Save, action: () => fire('profile-save') }] : []),
      ...(onDash ? [{ label: 'Edit layout', icon: SlidersHorizontal, action: () => fire('open-edit-layout') }] : []),
  ];
  const actions = [...baseActions, ...pageActions.map(a => ({ label: a.label, icon: a.icon, disabled: a.disabled, action: () => { if (a.disabled) return; setFan(false); void a.run(); } }))];
  const onTwoPane = onChat || onDash || onTasks || onLogs || onUsers || onProfile || onLocationEdit || onOrgEdit || /^\/(settings|library)/.test(route.pathname);
  return <div className="duo-navroot" data-duo-theme={theme}>
    {onTwoPane && <div className="duo-crease" aria-hidden />}
    <div className={`duo-topbar${onDash ? ' duo-topbar-dash' : ''}`}>
      <div className="duo-brandrow">
        <Button variant="ghost" className="duo-brand duo-brand-loc" aria-label="Go to Dash" onClick={() => navigate('/dashboard')}>{brandLogo ? <img src={brandLogo} alt="" /> : <i aria-hidden />}<span>{currentLocation?.name}</span></Button>
      </div>
      {!onDash && pageName && <div className="duo-pageline"><b>{pageName}</b>{pageStatus && <span>{pageStatus}</span>}</div>}
    </div>
    {fan && <Button variant="ghost" aria-label="Close actions" className="duo-dim" onClick={() => setFan(false)} />}
    {fan && <div className="duo-actions">{actions.map(a => <div key={a.label}><span className="duo-glass">{a.label}</span><Button variant="ghost" className={`duo-glass${a.disabled ? ' duo-act-off' : ''}`} aria-label={a.label} aria-disabled={a.disabled} onClick={a.action}><a.icon size={22} />{a.label === 'Nudge' && late > 0 && <b className="duo-badge">{late}</b>}</Button></div>)}</div>}
    <DuoOvation open={ovOpen} onOpenChange={setOvOpen} anchorTop={ovTop} />
    <div className="duo-wordmark-global" aria-hidden><img src="/croohq-wordmark.png" alt="" /></div>
    {hint && <span className="duo-orb-hint duo-glass">Hold to talk to Theo</span>}
    {(actions.length > 0 || canTalk) && <Button variant="ghost" aria-label={fan ? 'Close actions' : 'Open actions'} key={`orb-${bump}`} className={`duo-orb duo-glass${bump ? ' duo-orb-bump' : ''}${fly ? ' duo-orb-fly' : ''}`} onPointerDown={holdStart} onPointerUp={holdCancel} onPointerLeave={holdCancel} onPointerCancel={holdCancel} onContextMenu={(e) => e.preventDefault()} onClick={() => { setHint(false); if (held.current) { held.current = false; return; } if (actions.length === 0) { fire('open-theo-voice'); return; } setBump(b => b + 1); if (fan) setFan(false); else window.setTimeout(() => setFan(true), 230); }}>
      {fan ? <X /> : <><span className="duo-orb-ring" /><TheoOrb asSpan solid size={56} /></>}{!fan && late > 0 && <b className="duo-badge">{late}</b>}</Button>}
    <Button variant="ghost" aria-label="Close page menu" tabIndex={open ? 0 : -1} data-state={open ? 'open' : 'closed'} className="duo-dim duo-menu-dim" onClick={() => setOpen(false)} />
    <Button variant="ghost" className="duo-handle duo-glass" aria-label="Open page menu" onClick={() => setOpen(true)}><ChevronRight size={13} /></Button>
    <aside data-state={open ? 'open' : 'closed'} aria-hidden={!open} className="duo-menu duo-glass" aria-label="Page menu"><div className="duo-menu-title"><span className="duo-menu-name">CrooHQ</span>
        <span className="duo-theme-switch" role="radiogroup" aria-label="Theme">{([['auto', SunMoon, 'Auto'], ['paper', Sun, 'Paper'], ['oled', Moon, 'OLED']] as [DuoThemeMode, typeof Sun, string][]).map(([m, Ic, label]) => <Button key={m} variant="ghost" role="radio" aria-checked={themeMode === m} aria-label={label} className={themeMode === m ? 'duo-on' : ''} onClick={() => setDuoThemeMode(m)}><Ic size={16} /></Button>)}</span>
        <Button variant="ghost" aria-label="Close page menu" onClick={() => setOpen(false)}><X /></Button></div>
      <div className="duo-menu-top">
        <Button variant="ghost" className="duo-menu-loc" onClick={() => { setOpen(false); window.setTimeout(openLocation, 300); }}>{brandLogo ? <img src={brandLogo} alt="" /> : <i aria-hidden />}<span><b>{currentLocation?.name}</b><small>{brandName} · tap to switch</small></span><ChevronRight size={16} /></Button>
        {showOvation && <Button variant="ghost" className="duo-menu-ovation" onClick={(e) => { setOvTop(e.currentTarget.getBoundingClientRect().bottom); setOvOpen(o => !o); }}><span>Ovation</span><b>{ovation!.toFixed(1)}</b></Button>}
      </div>
      <div className="duo-menu-items">{menu.map(m => <Button key={m.title} variant="ghost" className={active(m.path) ? 'duo-selected' : ''} onClick={() => { setOpen(false); navigate(m.path); }}><m.icon size={21} />{m.title}{m.title === 'Chat' && chat && <b className="duo-badge">{chat}</b>}</Button>)}{timeItems.length > 0 && <><Button variant="ghost" className={`duo-menu-group${timeActive ? ' duo-selected' : ''}`} aria-expanded={timeOpen} onClick={() => setTimeOpen(o => !o)}><Clock size={21} />Time<ChevronDown size={16} className={`duo-group-chev${timeOpen ? ' duo-open' : ''}`} /></Button>{timeOpen && timeItems.map(m => <Button key={m.title} variant="ghost" className={`duo-menu-sub${active(m.path) ? ' duo-selected' : ''}`} onClick={() => { setOpen(false); navigate(m.path); }}><m.icon size={19} />{m.title}</Button>)}</>}</div>
      <div className="duo-userrow">
        <Button variant="ghost" className="duo-user" onClick={() => { setOpen(false); navigate('/my-profile'); }}>{profile?.profile_photo_url && <img src={profile.profile_photo_url} alt="" />}<span><b>{profile?.nickname || profile?.full_name}</b><small>{role?.replace(/_/g, ' ')}</small></span></Button>
        <Button variant="ghost" size="icon" className={`duo-gear${active('/settings') ? ' duo-selected' : ''}`} aria-label="Settings" onClick={() => { setOpen(false); navigate('/settings'); }}><Settings size={21} /></Button>
      </div>
    </aside>
  </div>;
}
