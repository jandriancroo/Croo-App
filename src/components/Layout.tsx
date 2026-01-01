import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Home, ClipboardCheck, Users, Calendar, MessageSquare, Menu, Clock, CalendarCheck, DollarSign, Settings as SettingsIcon, ChevronDown, ChevronRight, Scroll, DoorOpen, Wallet, FlaskConical, MapPin, BookOpen, Briefcase, Download, RefreshCw, BarChart3, Building2, User } from 'lucide-react';
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
      path: '/settings',
      label: 'Settings',
      icon: SettingsIcon
    }];

  return <div className="flex min-h-screen flex-col bg-background overflow-x-hidden">
      <header className="sticky top-0 z-50 glass border-b border-border/20" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className={`container max-w-7xl mx-auto flex items-center relative ${isMobile ? 'h-14' : 'h-16'}`}>
          <div className="flex items-center gap-2 mr-4 flex-shrink-0 min-w-[120px] md:min-w-[150px]">
            <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <img 
                src={headerLogo} 
                alt={headerLogoAlt} 
                className={`${isMobile ? 'h-10' : 'h-12'} w-auto max-w-[120px] object-contain rounded-lg`}
                style={{ background: 'transparent' }}
              />
            </button>
          </div>
          <nav className="hidden items-center gap-1 md:flex flex-1 min-w-0">
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
              <button onClick={() => navigate('/alerts')} title="Live Alerts" className="relative ml-1 p-2 hover:opacity-80 transition-opacity">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
                </span>
              </button>
            )}
          </nav>
          
          {/* Mobile Location Picker - truly centered with absolute positioning */}
          {isMobile && currentLocation && (
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
          
          {/* Mobile More Menu Button in header */}
          {isMobile && (
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

                  {/* Alerts - Admin only, right after profile */}
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

                  {hasMultiLocationAccess && (
                    <Button variant="outline" onClick={() => {
                      navigate('/multi-location');
                      setMenuOpen(false);
                    }} className="justify-start gap-3 h-11">
                      <Building2 className="h-5 w-5" />
                      <span className="text-base">Multi-Location</span>
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
                    return <Button key={item.path} variant={isActive ? 'secondary' : 'outline'} onClick={() => {
                      navigate(item.path);
                      setMenuOpen(false);
                    }} className="justify-start gap-3 h-11">
                      <Icon className="h-5 w-5" />
                      <span className="text-base">{item.label}</span>
                    </Button>;
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
          )}
          
          <div className="hidden md:flex items-center gap-2">
            {/* Location Selector */}
            {currentLocation && (
              <Button 
                variant="outline" 
                className="gap-2 h-9"
                onClick={() => setLocationDialogOpen(true)}
              >
                <MapPin className="h-4 w-4 flex-shrink-0" />
                <span className="max-w-[120px] truncate">{currentLocation.name}</span>
              </Button>
            )}

            {/* Profile dropdown - replaces settings icon */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 h-auto py-1.5 px-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={userProfile?.profile_photo_url || ''} />
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden lg:inline text-sm font-medium">{firstName}</span>
                  <ChevronDown className="h-3 w-3 flex-shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => navigate('/my-profile')} className="gap-2 cursor-pointer">
                  <User className="h-4 w-4" />
                  My Profile
                </DropdownMenuItem>
                {hasMultiLocationAccess && (
                  <DropdownMenuItem onClick={() => navigate('/multi-location')} className="gap-2 cursor-pointer">
                    <Building2 className="h-4 w-4 flex-shrink-0" />
                    <span className="whitespace-nowrap">Multi-Location</span>
                  </DropdownMenuItem>
                )}
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
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-accent backdrop-blur-lg border-t border-accent-foreground/10 md:hidden">
        <div className="flex items-center justify-evenly px-1 py-2" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))' }}>
          {mobileMainNavItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          const showBadge = item.path === '/messages' && unreadCount > 0;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-1.5 rounded-xl transition-colors relative ${
                isActive 
                  ? 'bg-white/20 text-white' 
                  : 'text-white/70 hover:text-white'
              }`}
            >
              <Icon className="h-7 w-7" strokeWidth={isActive ? 2.5 : 2} />
              <span className={`text-xs ${isActive ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
              {showBadge && (
                <span className="absolute top-1 right-1/4 h-2.5 w-2.5 bg-destructive rounded-full" />
              )}
            </button>
          );
        })}
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
