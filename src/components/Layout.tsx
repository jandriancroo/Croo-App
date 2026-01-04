import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Home, ClipboardCheck, Users, Calendar, MessageSquare, Menu, Clock, CalendarCheck, DollarSign, Settings as SettingsIcon, ChevronDown, ChevronRight, Scroll, DoorOpen, Wallet, FlaskConical, MapPin, BookOpen, Briefcase, Download, RefreshCw, BarChart3, Building2, User, Gamepad2, LayoutDashboard } from 'lucide-react';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useState, useEffect } from 'react';
import crooLogo from '@/assets/croo-logo.png';
import { LocationPickerDialog } from './LocationPickerDialog';
import { useUnreadMessages } from '@/hooks/useUnreadMessages';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Badge } from '@/components/ui/badge';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { openDiagnosticMode } from '@/components/DiagnosticMode';
import { FEATURE_FLAGS } from '@/config/featureFlags';
import { PullToRefresh } from './PullToRefresh';

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
    isManager,
    isShiftManager,
    canApproveRequests,
    canViewTimecards,
    loading: roleLoading
  } = useUserRole();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [timeMenuExpanded, setTimeMenuExpanded] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const { unreadCount } = useUnreadMessages();
  const { isChecklistOnlyLocation, currentLocation, setCurrentLocation } = useAppLocation();
  // Wait for role to load before checking - prevents flash of missing nav items
  const canAccessLogs = !roleLoading && isShiftManager; // Shift managers and above can access logbook
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [hasFBCAccess, setHasFBCAccess] = useState(false);
  const [hasMultiLocationAccess, setHasMultiLocationAccess] = useState(false);
const [updateAvailable, setUpdateAvailable] = useState<boolean | null>(null); // null = not checked yet
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [showOrgBubble, setShowOrgBubble] = useState(false); // Popup bubble for long-press

  // Auto-show update toast when new version detected
  useEffect(() => {
    const showUpdateToast = () => {
      setUpdateAvailable(true);
      toast('New version available', {
        description: 'Tap to update now',
        duration: Infinity, // Stay until dismissed or clicked
        action: {
          label: 'Update',
          onClick: () => {
            window.location.reload();
          },
        },
      });
    };

    // Listen for update events from service worker
    window.addEventListener('pwa:update-available', showUpdateToast);
    window.addEventListener('pwa:need-refresh', showUpdateToast);
    
    // Check if update was already detected before component mounted
    if ((window as any).__PWA_UPDATE_READY__ === true) {
      showUpdateToast();
    }

    return () => {
      window.removeEventListener('pwa:update-available', showUpdateToast);
      window.removeEventListener('pwa:need-refresh', showUpdateToast);
    };
  }, []);

  // Manual check for updates - force SW update + reload to pick up latest assets.
  // Note: when Workbox is configured with skipWaiting/clientsClaim, registration.waiting
  // is often null even when a new version exists, so we treat "check" as "refresh to latest".
  const checkForUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateAvailable(null);

    try {
      if (!('serviceWorker' in navigator)) {
        toast.info('Updates not supported in this browser.');
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        toast.info('No update system is active yet.');
        return;
      }

      // Ask the browser to fetch a newer SW if one exists.
      await registration.update();

      // Give it a beat to install/activate.
      await new Promise((r) => setTimeout(r, 750));

      const refreshedRegistration = await navigator.serviceWorker.getRegistration();

      // If a SW is waiting (some browsers), show "Install Update".
      if (refreshedRegistration?.waiting) {
        setUpdateAvailable(true);
        toast.success('Update ready! Tap Install Update.');
        return;
      }

      // Otherwise, reload the page. If a new version exists, this will load it.
      toast.message('Refreshing to load the latest version…');
      window.location.reload();
    } catch (error) {
      console.error('Error checking for updates:', error);
      toast.error('Failed to refresh to the latest version.');
      setUpdateAvailable(null);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // Check if user is super_admin or has FBC/brand_admin/multi-location access
  useEffect(() => {
    const checkRoles = async () => {
      if (!user?.id) {
        setIsSuperAdmin(false);
        setHasFBCAccess(false);
        setHasMultiLocationAccess(false);
        return;
      }
      
      // Check super_admin
      const { data: isSuperAdminResult } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'super_admin' });
      setIsSuperAdmin(isSuperAdminResult === true);
      
      // Check brand_admin or fbc role
      const { data: isBrandAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'brand_admin' });
      const { data: isFBC } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'fbc' });
      
      setHasFBCAccess(isSuperAdminResult === true || isBrandAdmin === true || isFBC === true);
      
      // Check multi-location access (org admin or brand admin)
      const { data: orgMemberships } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', user.id)
        .eq('org_role', 'admin')
        .limit(1);
      
      const hasOrgAdmin = orgMemberships && orgMemberships.length > 0;
      setHasMultiLocationAccess(isSuperAdminResult === true || isBrandAdmin === true || hasOrgAdmin);
    };
    checkRoles();
  }, [user?.id]);

  // Fetch user profile for avatar
  const { data: userProfile } = useQuery({
    queryKey: ['user-profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, profile_photo_url')
        .eq('id', user.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
  });

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
        .select('logo_url, name, brand_name')
        .eq('id', locationData.organization_id)
        .single();
      
      return orgData;
    },
    enabled: !!currentLocation?.id,
  });

  const headerLogo = orgLogo?.logo_url || crooLogo;
  const orgDisplayName = (orgLogo as any)?.brand_name || orgLogo?.name;
  const headerLogoAlt = orgLogo?.logo_url ? (orgDisplayName || 'Organization') : 'Croo';

  const firstName = userProfile?.full_name?.split(' ')[0] || 'User';
  const initials = userProfile?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U';

  // Force refresh PWA - clears all caches, storage, and reloads (complete reset)
  const handleRefreshApp = async () => {
    const confirmed = window.confirm('This will refresh the app and log you out. Continue?');
    if (!confirmed) return;
    
    try {
      toast.loading('Refreshing app...');
      
      // Unregister all service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
      
      // Clear all caches
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }
      
      // Clear localStorage and sessionStorage
      localStorage.clear();
      sessionStorage.clear();
      
      // Clear IndexedDB databases
      if ('indexedDB' in window) {
        const databases = await indexedDB.databases?.();
        if (databases) {
          for (const db of databases) {
            if (db.name) {
              indexedDB.deleteDatabase(db.name);
            }
          }
        }
      }
      
      // Force reload from server
      window.location.href = '/';
    } catch (error) {
      console.error('Failed to refresh app:', error);
      // Still clear what we can and reload
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/';
    }
  };

  // Checklist-only location navigation (Tasks, Chat, Logs, Settings)
  const checklistOnlyNavItems = [{
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
    icon: BookOpen
  }] : []), {
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
    }, ...(canViewTimecards ? [{
      path: '/time-tracking',
      label: 'Time Tracking',
      icon: DollarSign
    }, {
      path: '/punch-clock',
      label: 'Punch Clock',
      icon: Clock
    }] : [])
  ];
  // Mobile bottom nav: Dash, Chat, Tasks, Logs, Schedule (no More button - it's in header)
  const mobileMainNavItems = isChecklistOnlyLocation ? checklistOnlyNavItems : [{
    path: '/dashboard',
    label: 'Dash',
    icon: Home
  }, {
    path: '/messages',
    label: 'Chat',
    icon: MessageSquare
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

  // Time-related items for mobile collapsible section
  const mobileTimeItems = isChecklistOnlyLocation ? [] : [
    ...(FEATURE_FLAGS.CROO_CASH_ENABLED ? [{
      path: '/my-wallet',
      label: 'My Wallet',
      icon: Wallet
    }] : []),
    {
      path: '/availability',
      label: 'Availability',
      icon: CalendarCheck
    },
    ...(canViewTimecards ? [{
      path: '/time-tracking',
      label: 'Time Tracking',
      icon: DollarSign
    }, {
      path: '/punch-clock',
      label: 'Punch Clock',
      icon: Clock
    }] : [])
  ];

  // Other menu items (non-Time)
  const mobileMenuItems = isChecklistOnlyLocation ? checklistOnlyMobileMenuItems : [
    ...(isAdmin ? [{
      path: '/users',
      label: 'Users',
      icon: Users
    }, {
      path: '/hiring',
      label: 'Hiring',
      icon: Briefcase
    }] : []), {
      path: '/games',
      label: 'Arcade',
      icon: Gamepad2
    }, {
      path: '/settings',
      label: 'Settings',
      icon: SettingsIcon
    }];

  return <div className="flex min-h-screen flex-col bg-background overflow-x-hidden">
      {/* Desktop/Tablet Header with unified teal nav bar */}
      <header className="sticky top-0 z-50 hidden md:block bg-background pt-2" style={{ paddingTop: 'max(env(safe-area-inset-top), 0.5rem)' }}>
        <div className="container max-w-7xl mx-auto px-3 md:px-4">
          <div className="nav-bar-unified rounded-md flex items-center px-2">
            {/* Logo */}
            <button onClick={() => navigate('/dashboard')} className="nav-logo-inline hover:opacity-80 transition-opacity mr-2">
              <img 
                src={headerLogo} 
                alt={headerLogoAlt} 
              />
            </button>
            
            {/* Nav items */}
            <div className="flex items-center gap-0.5">
              {mainNavItems.map(item => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                const showBadge = item.path === '/messages' && unreadCount > 0;
                return (
                  <button 
                    key={item.path} 
                    onClick={() => navigate(item.path)} 
                    className={`relative flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                      isActive 
                        ? 'bg-white/25 text-primary-foreground font-medium' 
                        : 'text-primary-foreground/80 hover:bg-white/15 hover:text-primary-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="hidden lg:inline text-sm">{item.label}</span>
                    {showBadge && (
                      <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-[10px] rounded-full">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </Badge>
                    )}
                  </button>
                );
              })}
            
              {/* Time dropdown - hidden for checklist-only locations */}
              {!isChecklistOnlyLocation && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button 
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                        ['/my-wallet', '/availability', '/punch-clock', '/payroll-review'].includes(location.pathname)
                          ? 'bg-white/25 text-primary-foreground font-medium' 
                          : 'text-primary-foreground/80 hover:bg-white/15 hover:text-primary-foreground'
                      }`}
                    >
                      <Clock className="h-4 w-4 flex-shrink-0" />
                      <span className="hidden lg:inline text-sm">Time</span>
                      <ChevronDown className="h-3 w-3 flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center">
                    {timeMenuItems.map(item => {
                      const Icon = item.icon;
                      return (
                        <DropdownMenuItem key={item.path} onClick={() => navigate(item.path)} className="gap-2 cursor-pointer">
                          <Icon className="h-4 w-4" />
                          {item.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Right side items */}
            <div className="flex items-center gap-1 px-2">
              {/* Alerts button */}
              {!isChecklistOnlyLocation && (
                <button onClick={() => navigate('/alerts')} title="Live Alerts" className="relative p-2 hover:opacity-80 transition-opacity">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
                  </span>
                </button>
              )}

              {/* Location Selector */}
              {currentLocation && (
                <button 
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-primary-foreground/80 hover:bg-white/15 hover:text-primary-foreground"
                  onClick={() => setLocationDialogOpen(true)}
                >
                  <MapPin className="h-4 w-4 flex-shrink-0" />
                  <span className="max-w-[120px] truncate text-sm">{currentLocation.name}</span>
                </button>
              )}

              {/* Profile dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 px-2 py-1 rounded-lg transition-all text-primary-foreground/80 hover:bg-white/15 hover:text-primary-foreground">
                    <Avatar className="h-7 w-7 ring-2 ring-white/20">
                      <AvatarImage src={userProfile?.profile_photo_url || ''} />
                      <AvatarFallback className="text-xs bg-white/20 text-primary-foreground">{initials}</AvatarFallback>
                    </Avatar>
                    <span className="hidden lg:inline text-sm font-medium text-primary-foreground">{firstName}</span>
                    <ChevronDown className="h-3 w-3 flex-shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => navigate('/my-profile')} className="gap-2 cursor-pointer">
                    <User className="h-4 w-4" />
                    My Profile
                  </DropdownMenuItem>
                  {isAdmin && (
                    <>
                      <DropdownMenuItem onClick={() => navigate('/users')} className="gap-2 cursor-pointer">
                        <Users className="h-4 w-4" />
                        User Management
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/hiring')} className="gap-2 cursor-pointer">
                        <Briefcase className="h-4 w-4" />
                        Hiring
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onClick={() => navigate('/games')} className="gap-2 cursor-pointer">
                    <Gamepad2 className="h-4 w-4" />
                    Arcade
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 cursor-pointer">
                    <SettingsIcon className="h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut} className="gap-2 cursor-pointer text-destructive focus:text-destructive">
                    <DoorOpen className="h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Header */}
      <header className="sticky top-0 z-50 md:hidden bg-background border-b border-border/20" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="container max-w-7xl mx-auto flex items-center relative h-14">
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <img 
                src={headerLogo} 
                alt={headerLogoAlt} 
                className="h-10 w-auto max-w-[120px] object-contain rounded-lg"
                style={{ background: 'transparent' }}
              />
            </button>
          </div>
          
          {/* Mobile Location Picker - centered */}
          {currentLocation && (
            <div className="absolute left-1/2 -translate-x-1/2">
              <Button 
                variant="ghost" 
                className="gap-1.5 h-10 text-base font-medium"
                onClick={() => setLocationDialogOpen(true)}
              >
                <MapPin className="h-4 w-4 flex-shrink-0" />
                <span className="truncate max-w-[160px]">{currentLocation.name}</span>
                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
              </Button>
            </div>
          )}
          
          {/* Mobile More Menu Button */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                className="ml-auto p-2 hover:opacity-80 transition-opacity text-foreground"
                title="More options"
              >
                <Menu className="h-7 w-7" />
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="grid gap-2 py-4">
                {/* Profile Section */}
                <div 
                  className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30 mb-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    navigate('/my-profile');
                    setMenuOpen(false);
                  }}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={userProfile?.profile_photo_url || ''} />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{userProfile?.full_name || 'User'}</p>
                    <p className="text-xs text-muted-foreground">Tap to edit profile</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>

                {/* Alerts - Admin only */}
                {isAdmin && !isChecklistOnlyLocation && (
                  <Button 
                    variant={location.pathname === '/alerts' ? 'secondary' : 'outline'} 
                    onClick={() => {
                      navigate('/alerts');
                      setMenuOpen(false);
                    }} 
                    className="justify-start gap-3 h-11"
                  >
                    <span className="relative flex h-5 w-5 items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-destructive opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
                    </span>
                    <span className="text-base">Live Alerts</span>
                  </Button>
                )}

                {/* Time collapsible section */}
                {mobileTimeItems.length > 0 && (
                  <div className="space-y-1">
                    <Button 
                      variant="outline" 
                      onClick={() => setTimeMenuExpanded(!timeMenuExpanded)}
                      className="justify-between w-full h-11"
                    >
                      <div className="flex items-center gap-3">
                        <Clock className="h-5 w-5" />
                        <span className="text-base">Time</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 transition-transform ${timeMenuExpanded ? 'rotate-180' : ''}`} />
                    </Button>
                    {timeMenuExpanded && (
                      <div className="pl-4 space-y-1">
                        {mobileTimeItems.map(item => {
                          const Icon = item.icon;
                          const isActive = location.pathname === item.path;
                          return (
                            <Button 
                              key={item.path} 
                              variant={isActive ? 'secondary' : 'ghost'} 
                              onClick={() => {
                                navigate(item.path);
                                setMenuOpen(false);
                              }} 
                              className="justify-start gap-3 h-10 w-full"
                            >
                              <Icon className="h-4 w-4" />
                              <span className="text-sm">{item.label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {mobileMenuItems.map(item => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  const showBadge = item.path === '/messages' && unreadCount > 0;
                  return (
                    <Button 
                      key={item.path} 
                      variant={isActive ? 'secondary' : 'outline'} 
                      onClick={() => {
                        navigate(item.path);
                        setMenuOpen(false);
                      }} 
                      className="justify-start gap-3 h-11 relative"
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-base">{item.label}</span>
                      {showBadge && (
                        <Badge variant="destructive" className="ml-auto h-5 min-w-5 flex items-center justify-center p-0 text-[10px] rounded-full">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </Badge>
                      )}
                    </Button>
                  );
                })}

                <Button variant="outline" onClick={() => {
                  signOut();
                  setMenuOpen(false);
                }} className="justify-start gap-3 h-11 text-destructive hover:text-destructive">
                  <DoorOpen className="h-5 w-5" />
                  <span className="text-base">Sign Out</span>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <main className="container max-w-7xl mx-auto flex-1 px-3 md:px-4 py-3 md:py-8 pb-24 md:pb-8 overflow-x-hidden relative">
        {isMobile ? (
          <PullToRefresh>
            {children}
          </PullToRefresh>
        ) : (
          children
        )}
      </main>
      
      {/* Footer - desktop only */}
      <footer className="hidden md:flex items-center justify-center py-6 border-t border-border/20 text-muted-foreground gap-3">
        <span className="text-base">Powered by</span>
        <img src={crooLogo} alt="Croo" className="h-14 w-auto" />
      </footer>
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {/* Dash/Org Bubble Popup - swaps based on current route */}
        {showOrgBubble && hasMultiLocationAccess && (
          <div className="absolute bottom-full left-3 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
              onClick={() => {
                // Navigate to opposite view
                navigate(location.pathname === '/multi-location' ? '/dashboard' : '/multi-location');
                setShowOrgBubble(false);
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-background rounded-xl shadow-lg border border-border text-foreground font-medium"
            >
              {location.pathname === '/multi-location' ? (
                <>
                  <LayoutDashboard className="h-5 w-5" />
                  <span>Dash</span>
                </>
              ) : (
                <>
                  <Building2 className="h-5 w-5" />
                  <span>Org Dash</span>
                </>
              )}
            </button>
            {/* Triangle pointer */}
            <div className="absolute -bottom-2 left-6 w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-background" />
          </div>
        )}
        <div className="mx-3 mb-2 glass-dock rounded-2xl">
          <div className="relative z-10 flex items-center justify-evenly px-2 py-1.5">
            {mobileMainNavItems.map(item => {
            const isDashItem = item.path === '/dashboard';
            const isOnOrgDash = location.pathname === '/multi-location';
            
            // For Dash item, swap icon/label when on Org Dash
            const Icon = isDashItem && isOnOrgDash && hasMultiLocationAccess ? Building2 : item.icon;
            const label = isDashItem && isOnOrgDash && hasMultiLocationAccess ? 'Org' : item.label;
            const itemPath = isDashItem && isOnOrgDash && hasMultiLocationAccess ? '/multi-location' : item.path;
            
            const isActive = location.pathname === itemPath;
            const showBadge = item.path === '/messages' && unreadCount > 0;
            
            // Long-press handler for Dash button to show bubble
            let longPressTimer: ReturnType<typeof setTimeout> | null = null;
            const handleTouchStart = (e: React.TouchEvent) => {
              if (isDashItem && hasMultiLocationAccess) {
                // Prevent text selection
                e.preventDefault();
                longPressTimer = setTimeout(() => {
                  setShowOrgBubble(prev => !prev);
                  // Haptic feedback if available
                  if (navigator.vibrate) navigator.vibrate(50);
                }, 500);
              }
            };
            const handleTouchEnd = () => {
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
              }
            };
            
            return (
              <button
                key={item.path}
                onClick={() => {
                  // Close bubble if open and navigating
                  if (showOrgBubble) setShowOrgBubble(false);
                  navigate(itemPath);
                }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                className={`flex-1 flex flex-col items-center gap-1.5 py-1.5 rounded-xl transition-colors relative select-none ${
                  isActive 
                    ? 'bg-white/20 text-accent-foreground' 
                    : 'text-accent-foreground/70 hover:text-accent-foreground'
                }`}
              >
                <Icon className="h-7 w-7" strokeWidth={isActive ? 2.5 : 2} />
                <span className={`text-xs ${isActive ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                {showBadge && (
                  <span className="absolute top-1 right-1/4 h-2.5 w-2.5 bg-destructive rounded-full" />
                )}
              </button>
            );
          })}
          </div>
        </div>
      </nav>

      {/* Location Picker Dialog */}
      <LocationPickerDialog
        open={locationDialogOpen}
        onOpenChange={setLocationDialogOpen}
        currentLocationId={currentLocation?.id}
        onSelectLocation={(loc) => {
          setCurrentLocation({
            id: loc.id,
            name: loc.name,
            location_type: loc.location_type,
          });
        }}
      />
    </div>;
};
