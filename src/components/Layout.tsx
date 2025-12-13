import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Home, ClipboardCheck, Users, Calendar, MessageSquare, Menu, Clock, CalendarCheck, DollarSign, Settings as SettingsIcon, ChevronDown, Scroll, DoorOpen, Wallet, FlaskConical, MapPin, BookOpen, Briefcase, Download, RefreshCw } from 'lucide-react';
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
    isManager
  } = useUserRole();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const { unreadCount } = useUnreadMessages();
  const { isChecklistOnlyLocation, currentLocation, setCurrentLocation } = useAppLocation();
  const canAccessLogs = isAdmin || isManager;
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<boolean | null>(null); // null = not checked yet
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Manual check for updates - forces service worker to check against server
  const checkForUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          // Force the browser to check for a new service worker
          await registration.update();
          
          // Wait a moment for the update check to complete
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Re-fetch registration to get latest state
          const updatedRegistration = await navigator.serviceWorker.getRegistration();
          
          if (updatedRegistration?.waiting || updatedRegistration?.installing) {
            setUpdateAvailable(true);
            toast.success('Update available! Tap to install.');
          } else {
            setUpdateAvailable(false);
            toast.success('You\'re on the latest version!');
          }
        } else {
          setUpdateAvailable(false);
          toast.info('No service worker registered.');
        }
      } else {
        setUpdateAvailable(false);
        toast.info('Service workers not supported.');
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      toast.error('Failed to check for updates.');
      setUpdateAvailable(null);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

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
        <div className={`container flex items-center ${isMobile ? 'h-14' : 'h-16'}`}>
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80 transition-opacity mr-4 flex-shrink-0">
            <img 
              src={headerLogo} 
              alt={headerLogoAlt} 
              className={`${isMobile ? 'h-8' : 'h-10'} w-auto max-w-[100px] object-contain rounded-lg`}
              style={{ background: 'transparent' }}
            />
            {isSuperAdmin && !isMobile && (
              <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">
                v{__APP_VERSION__}
              </span>
            )}
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
              <DropdownMenuContent align="end" className="w-48">
                {isSuperAdmin && (
                  <>
                    <DropdownMenuItem onClick={() => openDiagnosticMode()} className="gap-2 cursor-pointer">
                      <FlaskConical className="h-4 w-4" />
                      Diagnostics
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {updateAvailable === true ? (
                  <DropdownMenuItem 
                    onClick={handleRefreshApp}
                    className="gap-2 rounded-md bg-red-200 text-red-900 hover:bg-red-300 dark:bg-red-900/50 dark:text-red-100 dark:hover:bg-red-900/70 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span className="flex-1">Install Update</span>
                    <span className="text-[10px] font-mono text-red-700 dark:text-red-200">
                      v{__APP_VERSION__}
                    </span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={checkForUpdate}
                    disabled={isCheckingUpdate}
                    className={`gap-2 rounded-md cursor-pointer ${
                      updateAvailable === false 
                        ? 'bg-green-200 text-green-900 hover:bg-green-300 dark:bg-green-900/50 dark:text-green-100 dark:hover:bg-green-900/70' 
                        : 'hover:bg-muted'
                    }`}
                  >
                    <RefreshCw className={`h-4 w-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                    <span className="flex-1">
                      {isCheckingUpdate ? 'Checking...' : updateAvailable === false ? 'Up to Date' : 'Check for Update'}
                    </span>
                    <span className={`text-[10px] font-mono ${updateAvailable === false ? 'text-green-700 dark:text-green-200' : 'text-muted-foreground'}`}>
                      v{__APP_VERSION__}
                    </span>
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 cursor-pointer">
                  <SettingsIcon className="h-4 w-4" />
                  Settings
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
      <main className="container flex-1 py-3 md:py-8 pb-24 md:pb-8 overflow-x-hidden relative">
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
      <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-border/20 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-around py-3 px-2">
          {mobileMainNavItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          const showBadge = item.path === '/messages' && unreadCount > 0;
          return <Button key={item.path} variant={isActive ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate(item.path)} className="flex-col gap-1.5 h-auto py-2 px-3 min-w-0 relative">
                <Icon className="h-9 w-9 flex-shrink-0" />
                <span className="text-sm font-medium truncate max-w-[70px]">{item.label}</span>
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
              <Button variant="ghost" size="sm" className="flex-col gap-1.5 h-auto py-2 px-3 min-w-0">
                <Menu className="h-9 w-9 flex-shrink-0" />
                <span className="text-sm font-medium truncate max-w-[70px]">More</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="grid gap-2 py-4">
                {/* Profile Section at top of mobile menu */}
                <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30 mb-2">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={userProfile?.profile_photo_url || ''} />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{userProfile?.full_name || 'User'}</p>
                    {currentLocation && (
                      <p className="text-xs text-muted-foreground truncate">{currentLocation.name}</p>
                    )}
                  </div>
                </div>

                {/* Location Selector */}
                {currentLocation && (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setLocationDialogOpen(true);
                      setMenuOpen(false);
                    }} 
                    className="justify-start gap-3 h-12"
                  >
                    <MapPin className="h-5 w-5" />
                    <span className="text-base">Change Location</span>
                  </Button>
                )}

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
                {updateAvailable === true ? (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      handleRefreshApp();
                      setMenuOpen(false);
                    }} 
                    className="justify-start gap-3 h-12 border-0 bg-red-200 text-red-900 hover:bg-red-300 dark:bg-red-900/50 dark:text-red-100 dark:hover:bg-red-900/70"
                  >
                    <Download className="h-5 w-5" />
                    <span className="text-base flex-1 text-left">Install Update</span>
                    <span className="text-[10px] font-mono text-red-700 dark:text-red-200">
                      v{__APP_VERSION__}
                    </span>
                  </Button>
                ) : (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      checkForUpdate();
                    }}
                    disabled={isCheckingUpdate}
                    className={`justify-start gap-3 h-12 border-0 ${
                      updateAvailable === false 
                        ? 'bg-green-200 text-green-900 hover:bg-green-300 dark:bg-green-900/50 dark:text-green-100 dark:hover:bg-green-900/70' 
                        : 'hover:bg-muted'
                    }`}
                  >
                    <RefreshCw className={`h-5 w-5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                    <span className="text-base flex-1 text-left">
                      {isCheckingUpdate ? 'Checking...' : updateAvailable === false ? 'Up to Date' : 'Check for Update'}
                    </span>
                    <span className={`text-[10px] font-mono ${updateAvailable === false ? 'text-green-700 dark:text-green-200' : 'text-muted-foreground'}`}>
                      v{__APP_VERSION__}
                    </span>
                  </Button>
                )}

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
