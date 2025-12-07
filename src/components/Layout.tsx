import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Home, ClipboardCheck, Users, Calendar, MessageSquare, Menu, Clock, CalendarCheck, DollarSign, Settings as SettingsIcon, ChevronDown, Scroll, DoorOpen, Wallet, FlaskConical } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useState, useEffect } from 'react';
import crooLogo from '@/assets/croo-logo.png';
import { LocationSelector } from '@/components/LocationSelector';
import { useUnreadMessages } from '@/hooks/useUnreadMessages';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Badge } from '@/components/ui/badge';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { openDiagnosticMode } from '@/components/DiagnosticMode';
import { FEATURE_FLAGS } from '@/config/featureFlags';

interface LayoutProps {
  children: ReactNode;
}
export const Layout = ({
  children
}: LayoutProps) => {
  // Setup push notifications only in Layout (after auth)
  usePushNotifications();
  
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAdmin,
    isManager
  } = useUserRole();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const { unreadCount } = useUnreadMessages();
  const { isChecklistOnlyLocation, currentLocation } = useAppLocation();
  const canAccessLogs = isAdmin || isManager;
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Check if user is super_admin
  useEffect(() => {
    const checkSuperAdmin = async () => {
      if (!user?.id) {
        setIsSuperAdmin(false);
        return;
      }
      const { data } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'super_admin' });
      setIsSuperAdmin(data === true);
    };
    checkSuperAdmin();
  }, [user?.id]);

  // Fetch organization logo based on current location
  const { data: orgLogo } = useQuery({
    queryKey: ['org-logo', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return null;
      
      const { data: locationData } = await supabase
        .from('locations')
        .select('organization_id')
        .eq('id', currentLocation.id)
        .single();
      
      if (!locationData?.organization_id) return null;
      
      const { data: orgData } = await supabase
        .from('organizations')
        .select('logo_url, name')
        .eq('id', locationData.organization_id)
        .single();
      
      return orgData;
    },
    enabled: !!currentLocation?.id,
  });

  const headerLogo = orgLogo?.logo_url || crooLogo;
  const headerLogoAlt = orgLogo?.logo_url ? (orgLogo.name || 'Organization') : 'Croo';

  // Checklist-only location navigation (Tasks, Chat, Settings only)
  const checklistOnlyNavItems = [{
    path: '/dashboard',
    label: 'Dash',
    icon: Home
  }, {
    path: '/tasks',
    label: 'Tasks',
    icon: ClipboardCheck
  }, {
    path: '/messages',
    label: 'Chat',
    icon: MessageSquare
  }];

  const mainNavItems = isChecklistOnlyLocation ? checklistOnlyNavItems : [{
    path: '/dashboard',
    label: 'Dash',
    icon: Home
  }, {
    path: '/tasks',
    label: 'Tasks',
    icon: ClipboardCheck
  }, ...(canAccessLogs ? [{
    path: '/logbook',
    label: 'Logs',
    icon: Scroll
  }] : []), {
    path: '/schedule',
    label: 'Schedule',
    icon: Calendar
  }, {
    path: '/messages',
    label: 'Chat',
    icon: MessageSquare
  }];
  const timeMenuItems = [
    ...(FEATURE_FLAGS.CROO_CASH_ENABLED ? [{
      path: '/my-wallet',
      label: 'My Wallet',
      icon: Wallet
    }] : []),
    {
      path: '/availability',
      label: 'Availability',
      icon: CalendarCheck
    }, ...(isAdmin ? [{
      path: '/punch-clock',
      label: 'Punch Clock',
      icon: Clock
    }, {
      path: '/payroll-review',
      label: 'Payroll Review',
      icon: DollarSign
    }] : [])
  ];
  const mobileMainNavItems = isChecklistOnlyLocation ? checklistOnlyNavItems : [{
    path: '/dashboard',
    label: 'Dash',
    icon: Home
  }, {
    path: '/tasks',
    label: 'Tasks',
    icon: ClipboardCheck
  }, {
    path: '/schedule',
    label: 'Schedule',
    icon: Calendar
  }, {
    path: '/messages',
    label: 'Chat',
    icon: MessageSquare
  }];

  // For checklist-only locations, only show Settings and Users in the mobile menu
  const checklistOnlyMobileMenuItems = [
    ...(isAdmin ? [{
      path: '/users',
      label: 'Users',
      icon: Users
    }] : []),
    {
      path: '/settings',
      label: 'Settings',
      icon: SettingsIcon
    }
  ];

  const mobileMenuItems = isChecklistOnlyLocation ? checklistOnlyMobileMenuItems : [...(canAccessLogs ? [{
    path: '/logbook',
    label: 'Logs',
    icon: Scroll
  }] : []),
    ...(FEATURE_FLAGS.CROO_CASH_ENABLED ? [{
      path: '/my-wallet',
      label: 'My Wallet',
      icon: Wallet
    }] : []),
    {
      path: '/availability',
      label: 'Availability',
      icon: CalendarCheck
    }, ...(isAdmin ? [{
      path: '/punch-clock',
      label: 'Punch Clock',
      icon: Clock
    }, {
      path: '/payroll-review',
      label: 'Payroll Review',
      icon: DollarSign
    }, {
      path: '/users',
      label: 'Users',
      icon: Users
    }] : []), {
      path: '/settings',
      label: 'Settings',
      icon: SettingsIcon
    }];
  return <div className="flex min-h-screen flex-col bg-background overflow-x-hidden">
      <header className="sticky top-0 z-50 glass border-b border-border/20" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className={`container flex items-center ${isMobile ? 'h-14' : 'h-16'}`}>
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80 transition-opacity mr-4 flex-shrink-0">
            <img 
              src={headerLogo} 
              alt={headerLogoAlt} 
              className={`${isMobile ? 'h-8' : 'h-10'} w-auto max-w-[100px] object-contain rounded-lg`}
              style={{ background: 'transparent' }}
            />
          </button>
          <nav className="hidden items-center gap-1 md:flex flex-1">
            {mainNavItems.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            const showBadge = item.path === '/messages' && unreadCount > 0;
            return <Button key={item.path} variant={isActive ? 'secondary' : 'ghost'} onClick={() => navigate(item.path)} className="gap-2 relative">
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden lg:inline">{item.label}</span>
                  {showBadge && (
                    <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-[10px] rounded-full">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Badge>
                  )}
                </Button>;
          })}
            
            {/* Time dropdown - hidden for checklist-only locations */}
            {!isChecklistOnlyLocation && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={['/my-wallet', '/availability', '/punch-clock', '/payroll-review'].includes(location.pathname) ? 'secondary' : 'ghost'} className="gap-2">
                    <Clock className="h-4 w-4 flex-shrink-0" />
                    <span className="hidden lg:inline">Time</span>
                    <ChevronDown className="h-3 w-3 flex-shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  {timeMenuItems.map(item => {
                  const Icon = item.icon;
                  return <DropdownMenuItem key={item.path} onClick={() => navigate(item.path)} className="gap-2 cursor-pointer">
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </DropdownMenuItem>;
                })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            
            {/* Alerts button - hidden for checklist-only locations */}
            {!isChecklistOnlyLocation && (
              <Button variant="ghost" size="icon" onClick={() => navigate('/alerts')} title="Live Alerts" className="relative hover:bg-muted ml-1 rounded-none font-extrabold">
                <div className="relative flex items-center justify-center h-5 w-5">
                  <div className="absolute h-5 w-5 bg-destructive rounded-full opacity-75"></div>
                  <div className="absolute h-5 w-5 bg-destructive rounded-full animate-ping"></div>
                  <div className="absolute h-3 w-3 bg-destructive rounded-full"></div>
                </div>
              </Button>
            )}
          </nav>
          
          {/* Mobile Alerts Button - hidden for checklist-only locations */}
          {!isChecklistOnlyLocation && (
            <Button variant="ghost" size="icon" onClick={() => navigate('/alerts')} title="Live Alerts" className="md:hidden relative hover:bg-muted rounded-none font-extrabold ml-auto">
              <div className="relative flex items-center justify-center h-5 w-5">
                <div className="absolute h-5 w-5 bg-destructive rounded-full opacity-75"></div>
                <div className="absolute h-5 w-5 bg-destructive rounded-full animate-ping"></div>
                <div className="absolute h-3 w-3 bg-destructive rounded-full"></div>
              </div>
            </Button>
          )}
          
          <div className="hidden md:flex items-center gap-2">
            {/* Settings dropdown - show for admins normally, or for all users in checklist-only locations */}
            {(isAdmin || isChecklistOnlyLocation) && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={['/settings', '/users'].includes(location.pathname) ? 'secondary' : 'ghost'} size="icon" title="Settings">
                    <SettingsIcon className="h-4 w-4 flex-shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isSuperAdmin && (
                    <>
                      <DropdownMenuItem onClick={() => openDiagnosticMode()} className="gap-2 cursor-pointer">
                        <FlaskConical className="h-4 w-4" />
                        Diagnostics
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 cursor-pointer">
                    <SettingsIcon className="h-4 w-4" />
                    Preferences
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => navigate('/users')} className="gap-2 cursor-pointer">
                      <Users className="h-4 w-4" />
                      User Management
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>}
            
            <Button variant="outline" onClick={signOut} size="icon" title="Sign Out" className="text-destructive hover:text-destructive">
              <DoorOpen className="h-4 w-4 flex-shrink-0" />
            </Button>
          </div>

        </div>
      </header>
      <main className="container flex-1 py-3 md:py-8 pb-24 md:pb-8 overflow-x-hidden">{children}</main>
      
      {/* Footer - desktop only */}
      <footer className="hidden md:flex items-center justify-center py-6 border-t border-border/20 text-muted-foreground gap-3">
        <span className="text-base">Powered by</span>
        <img src={crooLogo} alt="Croo" className="h-14 w-auto" />
      </footer>
      <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-border/20 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-around py-3 px-2">
          {mobileMainNavItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          const showBadge = item.path === '/messages' && unreadCount > 0;
          return <Button key={item.path} variant={isActive ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate(item.path)} className="flex-col gap-1 h-auto py-2 px-3 min-w-0 relative">
                <Icon className="h-6 w-6 flex-shrink-0" />
                <span className="text-xs truncate max-w-[70px]">{item.label}</span>
                {showBadge && (
                  <Badge variant="destructive" className="absolute -top-0.5 -right-0.5 h-5 min-w-5 flex items-center justify-center p-0 text-[9px] rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                )}
              </Button>;
        })}
          
          {/* Hamburger Menu for Additional Items */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="flex-col gap-1 h-auto py-2 px-3 min-w-0">
                <Menu className="h-6 w-6 flex-shrink-0" />
                <span className="text-xs truncate max-w-[70px]">More</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="grid gap-2 py-4">
                {isSuperAdmin && (
                  <Button variant="outline" onClick={() => {
                    openDiagnosticMode();
                    setMenuOpen(false);
                  }} className="justify-start gap-3 h-12">
                    <FlaskConical className="h-5 w-5" />
                    <span className="text-base">Diagnostics</span>
                  </Button>
                )}
                {mobileMenuItems.map(item => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return <Button key={item.path} variant={isActive ? 'secondary' : 'outline'} onClick={() => {
                  navigate(item.path);
                  setMenuOpen(false);
                }} className="justify-start gap-3 h-12">
                      <Icon className="h-5 w-5" />
                      <span className="text-base">{item.label}</span>
                    </Button>;
              })}
                <Button variant="outline" onClick={() => {
                signOut();
                setMenuOpen(false);
              }} className="justify-start gap-3 h-12 text-destructive hover:text-destructive">
                  <DoorOpen className="h-5 w-5" />
                  <span className="text-base">Sign Out</span>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>;
};