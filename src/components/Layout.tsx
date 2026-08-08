import { ReactNode, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOnboardingTour } from '@/hooks/useOnboardingTour';
import { OnboardingTour } from '@/components/onboarding/OnboardingTour';
import { registerMenuControl, unregisterMenuControl } from '@/components/onboarding/tourMenuBridge';
import { registerDockControl, unregisterDockControl } from '@/components/dock/dockBridge';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { CheckSquare, Users, Calendar, MessageSquare, Clock, CalendarCheck, DollarSign, Settings as SettingsIcon, ChevronDown, ChevronRight, FileText, DoorOpen, LogOut, MapPin, Briefcase, Building2, User, LayoutDashboard, Check, Mic, MicOff, Palette, Package, ArrowLeft, RefreshCw, Type, GraduationCap } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useState, useEffect } from 'react';
import crooLogo from '@/assets/croo-logo.webp';
import { LocationSwitchOverlay } from './LocationSwitchOverlay';
import { LocationPickerDialog } from './LocationPickerDialog';
import { InventoryModeBadge } from '@/components/inventory/InventoryModeBadge';
import { useInventoryMode } from '@/hooks/useInventoryMode';
import { useChatUnreadCounts } from '@/hooks/useChatUnreadCounts';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Badge } from '@/components/ui/badge';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { AiAssistantBubble } from '@/components/ai/AiAssistantBubble';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { openDiagnosticMode } from '@/components/DiagnosticMode';
import { getCurrentAppVersion } from '@/hooks/useForceReload';
import { FEATURE_FLAGS } from '@/config/featureFlags';
import { PullToRefresh } from './PullToRefresh';
import { useDockToast } from '@/contexts/DockToastContext';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { CompactDashboard } from '@/components/dock/CompactDashboard';
import { OvationScorePopover, OvationScoreTab, OvationExpandedPanel, OvationTriggerWithPanel, useOvationData } from '@/components/dashboard/OvationScorePopover';
import { syncChromeColor } from '@/utils/syncChrome';

interface LayoutProps {
  children: ReactNode;
}

interface DockContentProps {
  mobileMainNavItems: { path: string; label: string; icon: React.ElementType }[];
  hasMultiLocationAccess: boolean;
  showOrgBubble: boolean;
  setShowOrgBubble: (value: boolean | ((prev: boolean) => boolean)) => void;
  unreadCount: number;
  onSwipeUp: () => void;
  canViewSalesAndLabor: boolean;
  onOpenLocationPicker: (pendingPath?: string) => void;
}

const DockContent = ({ mobileMainNavItems, hasMultiLocationAccess, showOrgBubble, setShowOrgBubble, unreadCount, onSwipeUp, canViewSalesAndLabor, onOpenLocationPicker }: DockContentProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { dockContent } = useDockToast();
  const [bouncingItem, setBouncingItem] = useState<string | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Format currency for smart dock
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  // Handle swipe up detection
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    // If swiped up more than 50px, trigger expansion
    if (deltaY > 50) {
      onSwipeUp();
    }
    touchStartY.current = null;
  };

  return (
    <div 
      className="glass-dock overflow-hidden"
      onTouchStart={canViewSalesAndLabor ? handleTouchStart : undefined}
      onTouchEnd={canViewSalesAndLabor ? handleTouchEnd : undefined}
    >
      {/* Swipe handle indicator - only show for shift_manager+ */}
      {/* Tap on handle or swipe up to expand (tap works in preview mode) */}
      {canViewSalesAndLabor && (
        <div 
          className="flex justify-center pt-2 pb-1 cursor-pointer"
          onClick={onSwipeUp}
        >
          <div className="w-10 h-1 bg-accent-foreground/20 rounded-full" />
        </div>
      )}
      <div className={`relative z-10 flex items-center justify-evenly px-2 ${canViewSalesAndLabor ? 'pt-1' : 'pt-3'} pb-0`}>

        {/* Smart dock content (e.g., inventory counting) */}
        {dockContent && (
          <div data-inventory-smart-dock="true" className="w-full px-2 pb-1 space-y-2">
            {/* Stats row */}
            <div className="rounded-2xl border border-white/15 bg-black/10 px-4 py-2.5 backdrop-blur-sm">
              <div className="grid grid-cols-3 items-center gap-2 divide-x divide-white/15">
                <div className="text-center">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/55">Items</p>
                  <p className="mt-1 text-xl font-semibold leading-none tracking-tight text-white tabular-nums">
                    {dockContent.countedItems}
                    <span className="ml-1 text-xs font-medium text-white/55">/{dockContent.totalItems}</span>
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/55">Time</p>
                  <p className="mt-1 text-xl font-semibold leading-none text-white font-mono tabular-nums">
                    {Math.floor(dockContent.elapsedSeconds / 60)}<span className="ml-1 text-xs font-medium text-white/55">min</span>
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/55">Total Value</p>
                  <p className="mt-1 truncate text-xl font-semibold leading-none tracking-tight text-white tabular-nums">
                    {formatCurrency(dockContent.totalValue)}
                  </p>
                </div>
              </div>
              {dockContent.lastSavedAt && (
                <div className="mt-2 flex justify-center">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                    Saved
                  </span>
                </div>
              )}
            </div>

            {/* Action row */}
            <div className="flex items-stretch gap-2">
              {dockContent.onSave && (
                <button
                  onClick={dockContent.onSave}
                  className="flex-1 min-h-12 rounded-2xl border border-white/25 bg-white/20 px-4 text-white transition-colors hover:bg-white/30"
                >
                  <span className="flex items-center justify-center gap-2">
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-semibold leading-none tracking-wide">SAVE</span>
                  </span>
                </button>
              )}

              {dockContent.isVoiceSupported && !dockContent.isEditing && dockContent.onToggleVoice && (
                <button
                  onClick={dockContent.onToggleVoice}
                  className={`relative min-h-12 w-12 flex-shrink-0 rounded-2xl border transition-colors ${
                    dockContent.isListening
                      ? 'border-destructive bg-destructive text-destructive-foreground'
                      : 'border-white/25 bg-white/20 text-white hover:bg-white/30'
                  }`}
                  aria-label={dockContent.isListening ? 'Stop voice counting' : 'Start voice counting'}
                >
                  <span className="flex items-center justify-center">
                    {dockContent.isListening ? (
                      <MicOff className="h-5 w-5" />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                  </span>
                  {dockContent.isListening && (
                    <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-destructive animate-ping" />
                  )}
                </button>
              )}
            </div>
          </div>
        )}
        
        {/* Nav icons — hide when smart dock content is active */}
        {!dockContent && (
          <div className="flex items-center justify-evenly w-full">
            {mobileMainNavItems.map(item => {
              const isDashItem = item.path === '/dashboard';
              const isOnOrgDash = location.pathname === '/org-dash';
              
              // For Dash item, swap icon/label when on Org Dash
              const Icon = isDashItem && isOnOrgDash && hasMultiLocationAccess ? Building2 : item.icon;
              const label = isDashItem && isOnOrgDash && hasMultiLocationAccess ? 'Org' : item.label;
              const itemPath = isDashItem && isOnOrgDash && hasMultiLocationAccess ? '/org-dash' : item.path;
              
              const isActive = location.pathname === itemPath;
              const showBadge = item.path === '/messages' && unreadCount > 0;
              
              // Long-press handler for Dash button to show bubble
              let longPressTimer: ReturnType<typeof setTimeout> | null = null;
              const handleTouchStart = (e: React.TouchEvent) => {
                if (isDashItem && hasMultiLocationAccess) {
                  e.preventDefault();
                  longPressTimer = setTimeout(() => {
                    setShowOrgBubble(prev => !prev);
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
                    if (showOrgBubble) setShowOrgBubble(false);
                    // When on org-dash, ALL nav items (including Dash) open the location picker
                    if (isOnOrgDash) {
                      onOpenLocationPicker(isDashItem ? '/dashboard' : item.path);
                      return;
                    }
                    // Skip navigation if already on this route
                    if (location.pathname === itemPath) return;
                    // Trigger bounce animation
                    setBouncingItem(item.path);
                    setTimeout(() => setBouncingItem(null), 300);
                    navigate(itemPath);
                  }}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                  className={`dock-nav-button flex-1 flex flex-col items-center gap-0.5 py-1 rounded-xl transition-colors relative select-none ${
                    isActive 
                      ? 'bg-white/20 text-accent-foreground' 
                      : 'text-accent-foreground/70 hover:text-accent-foreground'
                  } ${bouncingItem === item.path ? 'dock-bouncing' : ''}`}
                >
                  <Icon className="h-8 w-8" strokeWidth={1.75} />
                  <span className={`text-[10px] ${isActive ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                  {showBadge && (
                    <span className="absolute top-1 right-1/4 h-2.5 w-2.5 bg-destructive rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const Layout = ({
  children
}: LayoutProps) => {
  // Setup push notifications only in Layout (after auth)
  usePushNotifications();
  const { runTour, completeTour, replayTour, isEligible: tourEligible } = useOnboardingTour();
  
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const {
    isAdmin,
    isManager,
    isOrgAdmin,
    isShiftManager,
    canViewSalesAndLabor,
    canViewTimecards,
    isSuperAdmin,
    isBrandAdmin,
    loading: roleLoading
  } = useUserRole();
  const isMobile = useIsMobile();
  const mobileHeaderRef = useRef<HTMLElement>(null);
  const headerLocationRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  // Register menu control so the onboarding tour can auto-open the menu
  useEffect(() => {
    registerMenuControl(setMenuOpen);
    return () => unregisterMenuControl();
  }, []);

  // Inventory count nav guard: while a count session is active, intercept
  // clicks that would navigate away from the count page (sidebar / mobile
  // nav / header tabs / location switcher / user menu) and show a toast
  // pointing the user at "Save & Exit". Allow Logout (security) and any
  // click inside the count page itself.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (typeof window === "undefined") return;
      const lock = window.__INVENTORY_COUNT_LOCK__;
      if (!lock?.active) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Allow clicks inside the count session itself
      if (target.closest("[data-inventory-count-session]")) return;
      // Allow the smart inventory dock controls (mobile SAVE / mic)
      if (target.closest("[data-inventory-smart-dock='true']")) return;
      // Allow clicks inside any toast / dialog / sheet popover (so dialogs and toasts work)
      if (target.closest("[data-sonner-toast], [role='dialog'], [role='alertdialog']")) return;
      // Allow logout (data-allow-during-count="logout")
      if (target.closest("[data-allow-during-count='logout']")) return;

      // Catch the common nav surfaces: header, mobile bottom nav, sidebar,
      // dropdown items, and the location switcher button + dialog trigger.
      const navTarget = target.closest(
        "header, nav, [data-mobile-nav], [data-sidebar], [data-location-switcher], [role='menuitem']"
      );
      if (!navTarget) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // Lazy import sonner to avoid pulling it into the layout bundle path
      import("sonner").then(({ toast }) => {
        toast.warning("Use Save & Exit to leave the count.", {
          id: "inv-count-lock-nav",
          duration: 2500,
        });
      });
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);
  const [timeMenuExpanded, setTimeMenuExpanded] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null);
  const { isChecklistOnlyLocation, currentLocation, setCurrentLocation, isSwitching, switchingTo, locations: allUserLocations } = useAppLocation();
  const { mode: currentInventoryMode, isConfigured: inventoryConfigured } = useInventoryMode(currentLocation?.id);
  
  
  const { counts: chatUnreadCounts } = useChatUnreadCounts(currentLocation?.id || null);
  const unreadCount = chatUnreadCounts.total;
  const { hasPermission, loading: permissionsLoading } = useRolePermissions();
  // Wait for role to load before checking - prevents flash of missing nav items
  const canAccessLogs = !roleLoading && isShiftManager; // Shift managers and above can access logbook
  const canAccessHiring = !roleLoading && (isOrgAdmin || isBrandAdmin || isSuperAdmin || hasPermission('manage_hiring'));
  // Ovation: mount eagerly, but never resolve the permission gate while auth/role/permission state is still loading.
  const ovationPermResolved = permissionsLoading ? null : (isManager || hasPermission('view_ovation_reviews'));
  const [canViewOvation, setCanViewOvation] = useState(() => {
    try { return localStorage.getItem('ovation-perm') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (ovationPermResolved !== null) {
      setCanViewOvation(ovationPermResolved);
      try { localStorage.setItem('ovation-perm', ovationPermResolved ? '1' : '0'); } catch { /* ignore */ }
    }
  }, [ovationPermResolved]);
  const [hasFBCAccess, setHasFBCAccess] = useState(false);
  const [hasMultiLocationAccess, setHasMultiLocationAccess] = useState(false);
const [updateAvailable, setUpdateAvailable] = useState<boolean | null>(null); // null = not checked yet
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [showOrgBubble, setShowOrgBubble] = useState(false); // Popup bubble for long-press
  const [showCompactDashboard, setShowCompactDashboard] = useState(false); // Swipe-up compact dashboard

  // Register dock control so the onboarding tour (and other features) can
  // auto-open the manager dash to point at Theo.
  useEffect(() => {
    registerDockControl(setShowCompactDashboard);
    return () => unregisterDockControl();
  }, []);

  // First-time Theo discovery: auto-peek the dock once so managers see Theo's new home.
  useEffect(() => {
    if (!isMobile || !canViewSalesAndLabor) return;
    try {
      if (localStorage.getItem('theo-welcome-autopeek-v1')) return;
    } catch { /* ignore */ }
    const t = setTimeout(() => {
      setShowCompactDashboard(true);
      try { localStorage.setItem('theo-welcome-autopeek-v1', String(Date.now())); } catch { /* ignore */ }
    }, 1200);
    return () => clearTimeout(t);
  }, [isMobile, canViewSalesAndLabor]);
  const [ovationExpanded, setOvationExpanded] = useState(false);
  const { displayScore: ovationDisplayScore, isLoading: ovationLoading } = useOvationData();
  const ovationHasContent = !!ovationDisplayScore || ovationLoading;
  const [theme, setTheme] = useState(localStorage.getItem('app-theme') || 'default');
  const [textSize, setTextSize] = useState(localStorage.getItem('app-text-size') || 'medium');
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);

  // Show version toast after "Update App" reload
  useEffect(() => {
    const prevVersion = sessionStorage.getItem('pre_update_version');
    if (prevVersion) {
      sessionStorage.removeItem('pre_update_version');
      const newVersion = getCurrentAppVersion();
      if (newVersion !== 'unknown' && prevVersion !== newVersion) {
        toast.success(`Updated from v${prevVersion} to v${newVersion}`);
      } else {
        toast.info(`Already on latest version (v${newVersion})`);
      }
    }
  }, []);

  const themes = [
    { value: 'default', label: 'Default' },
    { value: 'oled', label: 'Dark Mode' },
    { value: 'earth', label: 'Warm Earth' },
    { value: 'beach', label: 'Beach' },
    { value: 'cupcake', label: 'Cupcake' },
    { value: 'blaze', label: 'Blaze Pizza' },
    { value: 'playa', label: 'Playa Bowls' },
  ];

  const handleThemeChange = (value: string) => {
    setTheme(value);
    localStorage.setItem('app-theme', value);
    document.documentElement.setAttribute('data-theme', value);
    syncChromeColor();
    toast('Theme updated');
  };



  const textSizes = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ];

  const handleTextSizeChange = (value: string) => {
    setTextSize(value);
    localStorage.setItem('app-text-size', value);
    document.documentElement.setAttribute('data-text-size', value);
  };

  // Apply saved text size on mount
  useEffect(() => {
    const saved = localStorage.getItem('app-text-size');
    if (saved) document.documentElement.setAttribute('data-text-size', saved);
  }, []);

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

  // Derive super_admin/brand_admin from useUserRole cache — no extra RPCs needed
  // Only check FBC role and org_admin multi-location access (not available in useUserRole)
  useEffect(() => {
    const checkExtras = async () => {
      if (!user?.id) {
        setHasFBCAccess(false);
        setHasMultiLocationAccess(false);
        return;
      }
      
      // Only fetch what useUserRole doesn't provide: FBC role + org_admin membership
      const [fbcResult, orgMembershipsResult] = await Promise.all([
        supabase.rpc('has_role', { _user_id: user.id, _role: 'fbc' }),
        supabase
          .from('organization_members')
          .select('id')
          .eq('user_id', user.id)
          .eq('org_role', 'admin')
          .limit(1)
      ]);
      
      const isFBC = fbcResult.data === true;
      const hasOrgAdmin = orgMembershipsResult.data && orgMembershipsResult.data.length > 0;
      
      setHasFBCAccess(isSuperAdmin || isBrandAdmin || isFBC);
      setHasMultiLocationAccess(isSuperAdmin || isBrandAdmin || !!hasOrgAdmin);
    };
    checkExtras();
  }, [user?.id, isSuperAdmin, isBrandAdmin]);

   // iOS overscroll/rubber-band prevention is handled entirely by CSS:
   //   overscroll-behavior: none  on html/body (in index.css PWA rules)
   // No touchmove preventDefault needed — that approach kills scroll gestures
   // because iOS cancels the entire gesture if ANY touchmove is prevented.

  // Fetch user profile for avatar
  const { data: userProfile } = useQuery({
    queryKey: ['user-profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, profile_photo_url, nickname')
        .eq('id', user.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
  });

  // Fetch brand/org logo based on current location.
  // Priority: location.brand_id -> org.brand_id -> org.logo_url.
  // A location may have brand_id set directly with no organization_id
  // (Lite / brand-direct locations), so we must NOT early-return on missing org.
  const { data: orgLogo, isLoading: orgLogoLoading } = useQuery({
    queryKey: ['org-logo', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return null;

      const { data: locationData } = await supabase
        .from('locations')
        .select('brand_id, organization_id')
        .eq('id', currentLocation.id)
        .single();

      if (!locationData) return null;

      // Load org (if any) in parallel with a direct brand lookup
      const [orgRes, directBrandRes] = await Promise.all([
        locationData.organization_id
          ? supabase
              .from('organizations')
              .select('logo_url, name, brand_name, brand_id')
              .eq('id', locationData.organization_id)
              .single()
          : Promise.resolve({ data: null as any }),
        locationData.brand_id
          ? supabase
              .from('brands')
              .select('logo_url, name')
              .eq('id', locationData.brand_id)
              .single()
          : Promise.resolve({ data: null as any }),
      ]);

      const orgData = orgRes.data;
      let brandData = directBrandRes.data;

      // Fall back to org's brand_id when the location has no direct brand link
      if (!brandData?.logo_url && orgData?.brand_id) {
        const { data } = await supabase
          .from('brands')
          .select('logo_url, name')
          .eq('id', orgData.brand_id)
          .single();
        if (data?.logo_url) brandData = data;
      }

      // Brand logo wins whenever present — every brand has one
      if (brandData?.logo_url) {
        return {
          logo_url: brandData.logo_url,
          name: orgData?.name || brandData.name,
          brand_name: brandData.name,
        };
      }

      return orgData;
    },
    enabled: !!currentLocation?.id,
    staleTime: 5 * 60 * 1000, // 5 min — matches prefetch, logo rarely changes
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });


  // Cache the brand logo URL for instant load on next visit.
  // We keep BOTH a per-location key and a "last known" key: on slow/flaky
  // networks (older iPhones, corporate Windows machines) the logo query can
  // fail or resolve late, and without the last-known fallback the header
  // snapped to the generic Croo mark instead of the brand.
  useEffect(() => {
    if (orgLogo?.logo_url && currentLocation?.id) {
      localStorage.setItem(`brand-logo-${currentLocation.id}`, orgLogo.logo_url);
      localStorage.setItem('brand-logo-last', orgLogo.logo_url);
    }
  }, [orgLogo?.logo_url, currentLocation?.id]);

  // Get cached logo for instant display (before query completes)
  const cachedLogoUrl = currentLocation?.id 
    ? localStorage.getItem(`brand-logo-${currentLocation.id}`) 
    : null;
  const lastKnownLogoUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('brand-logo-last') : null;

  // If the brand image itself fails to decode/download, degrade to the Croo mark
  const [brandLogoBroken, setBrandLogoBroken] = useState(false);
  const resolvedBrandLogo = orgLogo?.logo_url || cachedLogoUrl || lastKnownLogoUrl;
  useEffect(() => { setBrandLogoBroken(false); }, [resolvedBrandLogo]);

  // Use cached logo immediately, then update when query completes
  const headerLogo = (!brandLogoBroken && resolvedBrandLogo) || (orgLogoLoading ? null : crooLogo);
  const orgDisplayName = (orgLogo as any)?.brand_name || orgLogo?.name;
  const headerLogoAlt = (!brandLogoBroken && resolvedBrandLogo) ? (orgDisplayName || 'Organization') : 'Croo';


  // Fetch org/brand name for org-dash header label
  const isOnOrgDash = location.pathname === '/org-dash';
  const orgIdFromUrl = searchParams.get('org');
  const brandIdFromUrl = searchParams.get('brand');
  const { data: orgDashName } = useQuery({
    queryKey: ['org-dash-name-v2', orgIdFromUrl, brandIdFromUrl],
    queryFn: async () => {
      if (brandIdFromUrl) {
        const { data } = await supabase
          .from('brands')
          .select('name')
          .eq('id', brandIdFromUrl)
          .single();
        return data?.name ?? null;
      }
      if (!orgIdFromUrl) return null;
      const { data } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', orgIdFromUrl)
        .single();
      return data?.name ?? null;
    },
    enabled: isOnOrgDash && !!(orgIdFromUrl || brandIdFromUrl),
    staleTime: 5 * 60 * 1000,
  });

  const displayFullName = (userProfile as any)?.nickname
    ? [(userProfile as any).nickname, ...(userProfile?.full_name?.split(' ').slice(1) || [])].join(' ')
    : userProfile?.full_name;
  const firstName = (userProfile as any)?.nickname || userProfile?.full_name?.split(' ')[0] || 'User';
  const initials = displayFullName?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'U';

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
    icon: LayoutDashboard
  }, {
    path: '/tasks',
    label: 'Tasks',
    icon: CheckSquare
  }, ...(canAccessLogs ? [{
    path: '/logbook',
    label: 'Logs',
    icon: FileText
  }] : []), {
    path: '/messages',
    label: 'Chat',
    icon: MessageSquare
  }];

  const mainNavItems = isChecklistOnlyLocation ? checklistOnlyNavItems : [{
    path: '/dashboard',
    label: 'Dash',
    icon: LayoutDashboard
  }, {
    path: '/tasks',
    label: 'Tasks',
    icon: CheckSquare
  }, ...(canAccessLogs ? [{
    path: '/logbook',
    label: 'Logs',
    icon: FileText
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
    {
      path: '/my-timecard',
      label: 'My Timecard',
      icon: Clock
    },
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
    icon: LayoutDashboard
  }, {
    path: '/messages',
    label: 'Chat',
    icon: MessageSquare
  }, {
    path: '/tasks',
    label: 'Tasks',
    icon: CheckSquare
  }, ...(canAccessLogs ? [{
    path: '/logbook',
    label: 'Logs',
    icon: FileText
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
    {
      path: '/my-timecard',
      label: 'My Timecard',
      icon: DollarSign
    },
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
    // Admins see Users, others see My Team
    ...(isAdmin ? [{
      path: '/users',
      label: 'Users',
      icon: Users
    }] : [{
      path: '/my-team',
      label: 'My Team',
      icon: Users
    }]),
    ...(canAccessHiring ? [{
      path: '/hiring',
      label: 'Hiring',
      icon: Briefcase
    }] : []),
    ...(((isManager || hasPermission('manage_inventory')) && inventoryConfigured) ? [{
      path: currentLocation?.id ? `/inventory/${currentLocation.id}` : '/inventory',
      label: 'Inventory',
      icon: Package
    }] : []),
    {
      path: '/settings',
      label: 'Settings',
      icon: SettingsIcon
    }];

  return <div className="flex min-h-screen flex-col bg-background">
      {/* Desktop/Tablet Header with unified teal nav bar */}
      <header className={`sticky top-0 z-50 bg-background pt-2 ${isMobile ? 'hidden' : 'block'}`} style={{ paddingTop: 'max(env(safe-area-inset-top), 0.5rem)' }}>
        <div className="container max-w-7xl mx-auto px-3 md:px-4">
          <div className="nav-bar-unified rounded-md flex items-center px-2">
            {/* Logo */}
            <div className="nav-logo-inline mr-2">
              {headerLogo ? (
                <img 
                  src={headerLogo} 
                  alt={headerLogoAlt} 
                />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-white/20" />
              )}
            </div>
            
            {/* Nav items */}
            <div className="flex items-center gap-0.5">
              {mainNavItems.map(item => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                const showBadge = item.path === '/messages' && unreadCount > 0;
                const isOnOrgDash = location.pathname === '/org-dash';
                const isLocationSpecific = item.path !== '/dashboard';
                return (
                  <button 
                    key={item.path} 
                    onClick={() => {
                      // When on org-dash, ALL nav items open the location picker
                      if (isOnOrgDash) {
                        setPendingNavPath(item.path);
                        setLocationDialogOpen(true);
                        return;
                      }
                      navigate(item.path);
                    }}
                    className={`relative flex items-center gap-2 px-2 lg:px-3 py-1.5 rounded-lg transition-all ${
                      isActive 
                        ? 'bg-white/25 text-primary-foreground font-medium' 
                        : 'text-primary-foreground/80 hover:bg-white/15 hover:text-primary-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="text-sm hidden lg:inline">{item.label}</span>
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
                      className={`flex items-center gap-2 px-2 lg:px-3 py-1.5 rounded-lg transition-all ${
                        ['/my-timecard', '/availability', '/punch-clock', '/payroll-review'].includes(location.pathname)
                          ? 'bg-white/25 text-primary-foreground font-medium' 
                          : 'text-primary-foreground/80 hover:bg-white/15 hover:text-primary-foreground'
                      }`}
                    >
                      <Clock className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm hidden lg:inline">Time</span>
                      <ChevronDown className="h-3 w-3 flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center">
                    {timeMenuItems.map(item => {
                      const Icon = item.icon;
                      return (
                        <DropdownMenuItem key={item.path} onClick={() => {
                          if (isOnOrgDash) {
                            setPendingNavPath(item.path);
                            setLocationDialogOpen(true);
                          } else {
                            navigate(item.path);
                          }
                        }} className="gap-2 cursor-pointer">
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

              {/* Location Selector */}
              {(currentLocation || location.pathname === '/org-dash') && (
                <button 
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-primary-foreground/80 hover:bg-white/15 hover:text-primary-foreground"
                  onClick={() => setLocationDialogOpen(true)}
                >
                  <MapPin className="h-4 w-4 flex-shrink-0" />
                  <span className="max-w-[160px] truncate text-sm flex flex-col items-start leading-tight">
                    <span className="truncate">{isOnOrgDash ? (orgDashName || 'Select Location') : currentLocation?.name}</span>
                  </span>
                </button>
              )}
              
              {/* Desktop Ovation Score - only on dashboard */}
              {canViewOvation !== false && location.pathname === '/dashboard' && ovationHasContent && (
                <OvationScorePopover key={`ovation-desktop-${currentLocation?.id ?? 'pending'}`} />
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
                  {!roleLoading && isAdmin && (
                    <>
                      <DropdownMenuItem onClick={() => {
                        if (location.pathname === '/org-dash') {
                          setPendingNavPath('/users');
                          setLocationDialogOpen(true);
                        } else {
                          navigate('/users');
                        }
                      }} className="gap-2 cursor-pointer">
                        <Users className="h-4 w-4" />
                        User Management
                      </DropdownMenuItem>
                      {canAccessHiring && (
                      <DropdownMenuItem onClick={() => navigate('/hiring')} className="gap-2 cursor-pointer">
                        <Briefcase className="h-4 w-4" />
                        Hiring
                      </DropdownMenuItem>
                      )}
                      {(isManager || hasPermission('manage_inventory')) && inventoryConfigured && (
                      <DropdownMenuItem onClick={() => navigate(currentLocation?.id ? `/inventory/${currentLocation.id}` : '/')} className="gap-2 cursor-pointer">
                        <Package className="h-4 w-4" />
                        <span className="flex-1">Inventory</span>
                        <InventoryModeBadge mode={currentInventoryMode} />
                      </DropdownMenuItem>
                      )}
                    </>
                  )}
                  {!isAdmin && (
                    <DropdownMenuItem onClick={() => navigate('/my-team')} className="gap-2 cursor-pointer">
                      <Users className="h-4 w-4" />
                      My Team
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 cursor-pointer">
                    <SettingsIcon className="h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut} data-allow-during-count="logout" className="gap-2 cursor-pointer text-destructive focus:text-destructive">
                    <DoorOpen className="h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Header — Full Bleed + Bottom Curve (fixed to prevent pull-to-refresh detach) */}
      <header
        ref={mobileHeaderRef}
        className={`fixed top-0 left-0 right-0 z-50 bg-primary ${isMobile ? 'block' : 'hidden'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)', background: 'var(--chrome-bg, hsl(var(--header-bg)))', borderRadius: '0 0 1.25rem 1.25rem', boxShadow: '0 4px 16px hsl(0 0% 0% / 0.10)' }}
      >
        <div className="flex items-center relative h-14 px-4">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="nav-logo-inline">
              {headerLogo ? (
                <img 
                  src={headerLogo} 
                  alt={headerLogoAlt} 
                />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-white/20" />
              )}
            </div>
          </div>
          
          {(() => {
            const showOvation = canViewOvation !== false && location.pathname === '/dashboard' && ovationHasContent;
            const showLocation = !!(currentLocation || isOnOrgDash);
            if (!showLocation && !showOvation) return null;

            const locationLabel = isOnOrgDash ? (orgDashName || 'Select Location') : currentLocation?.name;

            return (
              <div
                className="absolute left-1/2 -translate-x-1/2 flex items-center"
                ref={headerLocationRef}
              >
                <div
                  className={cn(
                    'relative flex items-center',
                    showOvation && showLocation && 'bg-white/15 rounded-lg'
                  )}
                >
                  {showLocation && (
                    <button
                      type="button"
                      onClick={() => setLocationDialogOpen(true)}
                      data-tour="location-picker"
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 h-10 text-base font-medium text-primary-foreground transition-colors',
                        showOvation
                          ? 'rounded-l-lg hover:bg-white/10'
                          : 'rounded-lg hover:bg-white/15'
                      )}
                    >
                      <MapPin className="h-4 w-4 flex-shrink-0" />
                      <span className="flex flex-col items-start leading-tight">
                        <span className="truncate max-w-[160px]">{locationLabel}</span>
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
                    </button>
                  )}
                  {showOvation && showLocation && (
                    <span aria-hidden className="h-5 w-px bg-white/20" />
                  )}
                  {showOvation && (
                    <OvationTriggerWithPanel
                      bare={showLocation}
                      desktop={!showLocation}
                      className={showLocation ? 'rounded-r-lg' : undefined}
                      expanded={ovationExpanded}
                      onToggle={() => setOvationExpanded(prev => !prev)}
                      onClose={() => setOvationExpanded(false)}
                    />
                  )}

                </div>
              </div>
            );
          })()}


          {/* Mobile Menu - Profile Avatar */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                className="p-1 rounded-full transition-colors ml-auto"
                title="More options"
              >
                <Avatar className="h-9 w-9 ring-2 ring-white/30">
                  <AvatarImage src={userProfile?.profile_photo_url || ''} />
                  <AvatarFallback className="text-xs bg-white/20 text-primary-foreground">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </SheetTrigger>

            <SheetContent side="bottom" className="h-auto max-h-[90vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="grid gap-2 py-4">
                {/* Profile + Sign Out row */}
                <div className="grid grid-cols-[1fr_auto] gap-2 mb-2">
                  <div
                    className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors min-w-0"
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
                      <p className="font-medium truncate">{displayFullName || 'User'}</p>
                      <p className="text-xs text-muted-foreground">Tap to edit profile</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setSignOutConfirmOpen(true)}
                    data-allow-during-count="logout"
                    aria-label="Sign out"
                    className="h-auto w-14 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <LogOut className="h-5 w-5" />
                  </Button>
                </div>



                {/* Time block (button + sub-items tinted together) */}
                {mobileTimeItems.length > 0 && (
                  <div className={`rounded-md overflow-hidden ${timeMenuExpanded ? 'border bg-muted/40' : ''}`}>
                    <Button
                      variant="outline"
                      onClick={() => setTimeMenuExpanded(!timeMenuExpanded)}
                      className={`justify-between h-9 px-3 w-full ${timeMenuExpanded ? 'border-0 bg-transparent hover:bg-transparent rounded-none' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <span className="text-sm">Time</span>
                      </div>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${timeMenuExpanded ? 'rotate-180' : ''}`} />
                    </Button>
                    {timeMenuExpanded && (
                      <div className="px-2 pb-2 pt-1 grid gap-1 border-t">
                        {mobileTimeItems.map(item => {
                          const Icon = item.icon;
                          const isActive = location.pathname === item.path;
                          return (
                            <Button
                              key={item.path}
                              variant={isActive ? 'secondary' : 'ghost'}
                              onClick={() => {
                                if (isOnOrgDash) {
                                  setPendingNavPath(item.path);
                                  setLocationDialogOpen(true);
                                  setMenuOpen(false);
                                } else {
                                  navigate(item.path);
                                  setMenuOpen(false);
                                }
                              }}
                              className="justify-start gap-2 h-8 w-full"
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span className="text-xs">{item.label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Users / My Team */}
                {mobileMenuItems.filter(i => i.path === '/users' || i.path === '/my-team').map(item => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Button
                      key={item.path}
                      variant={isActive ? 'secondary' : 'outline'}
                      onClick={() => {
                        navigate(item.path);
                        setMenuOpen(false);
                      }}
                      className="justify-start gap-2 h-9 px-3"
                      data-tour={item.path === '/users' ? 'nav-users' : item.path === '/my-team' ? 'nav-users' : undefined}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-sm">{item.label}</span>
                    </Button>
                  );
                })}

                {/* Hiring + Inventory row (2 columns) */}
                {(() => {
                  const pairItems = mobileMenuItems.filter(i => 
                    i.path === '/hiring' || i.path.startsWith('/inventory')
                  );
                  if (pairItems.length === 0) return null;
                  return (
                    <div className="grid grid-cols-1 gap-2">
                      {pairItems.map(item => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;
                        return (
                          <Button 
                            key={item.path} 
                            variant={isActive ? 'secondary' : 'outline'} 
                            onClick={() => {
                              const orgLevelPaths = ['/hiring', '/my-team'];
                              if (location.pathname === '/org-dash' && !orgLevelPaths.includes(item.path)) {
                                setPendingNavPath(item.path);
                                setLocationDialogOpen(true);
                                setMenuOpen(false);
                              } else {
                                navigate(item.path);
                                setMenuOpen(false);
                              }
                            }}
                            className="justify-between h-9 px-3"
                          >
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              <span className="text-sm">{item.label}</span>
                            </span>
                            {item.path.startsWith('/inventory') && (
                              <InventoryModeBadge mode={currentInventoryMode} />
                            )}
                          </Button>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Settings (full width) */}
                {mobileMenuItems.filter(i => i.path === '/settings').map(item => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Button 
                      key={item.path} 
                      variant={isActive ? 'secondary' : 'outline'} 
                      onClick={() => {
                        navigate(item.path);
                        setMenuOpen(false);
                      }}
                      className="justify-start gap-2 h-9"
                      data-tour="nav-settings"
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-sm">{item.label}</span>
                    </Button>
                  );
                })}

                {/* Messages badge (if exists in menu items) */}
                {mobileMenuItems.filter(i => i.path === '/messages').map(item => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  const showBadge = unreadCount > 0;
                  return (
                    <Button 
                      key={item.path} 
                      variant={isActive ? 'secondary' : 'outline'} 
                      onClick={() => {
                        navigate(item.path);
                        setMenuOpen(false);
                      }}
                      className="justify-start gap-2 h-9 relative"
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-sm">{item.label}</span>
                      {showBadge && (
                        <Badge variant="destructive" className="ml-auto h-4 min-w-4 flex items-center justify-center p-0 text-[9px] rounded-full">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </Badge>
                      )}
                    </Button>
                  );
                })}

                {/* Display Settings - Theme + Text Size */}
                <div className={`rounded-md overflow-hidden ${displaySettingsOpen ? 'border bg-muted/40' : ''}`}>
                  <Button
                    variant="outline"
                    onClick={() => setDisplaySettingsOpen(!displaySettingsOpen)}
                    className={`justify-between h-9 px-3 w-full ${displaySettingsOpen ? 'border-0 bg-transparent hover:bg-transparent rounded-none' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-baseline w-4 h-4 justify-center font-semibold leading-none"><span className="text-sm">T</span><span className="text-[10px]">t</span></span>
                      <span className="text-sm">Display</span>
                    </div>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${displaySettingsOpen ? 'rotate-180' : ''}`} />
                  </Button>
                  {displaySettingsOpen && (
                    <div className="px-2 pb-2 pt-1 space-y-2 border-t">
                      <div className="flex items-center gap-2 pl-4 pr-2 h-8">
                        <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Theme</span>
                        <Select value={theme} onValueChange={handleThemeChange}>
                          <SelectTrigger className="flex-1 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {themes.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2 pl-4 pr-2 h-8">
                        <Type className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Text</span>
                        <Select value={textSize} onValueChange={handleTextSizeChange}>
                          <SelectTrigger className="flex-1 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {textSizes.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Replay Tour (shift_manager+) */}
                {tourEligible && (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setMenuOpen(false);
                      replayTour();
                    }}
                    className="justify-start gap-2 h-9"
                  >
                    <GraduationCap className="h-4 w-4" />
                    <span className="text-sm">Tour CrooHQ</span>
                  </Button>
                )}

                {/* Update App */}
                <Button variant="outline" onClick={() => {
                  setMenuOpen(false);
                  const prevVersion = getCurrentAppVersion();
                  sessionStorage.setItem('pre_update_version', prevVersion);
                  toast.info('Updating app...');
                  setTimeout(() => window.location.reload(), 500);
                }} className="justify-start gap-2 h-9 px-3">
                  <RefreshCw className="h-4 w-4" />
                  <span className="text-sm">Update</span>
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          <AlertDialog open={signOutConfirmOpen} onOpenChange={setSignOutConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign out of CrooHQ?</AlertDialogTitle>
                <AlertDialogDescription>
                  You'll need to sign back in to access your locations, schedules, and inventory.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setSignOutConfirmOpen(false);
                    setMenuOpen(false);
                    signOut();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Sign out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>
      
      
      <main className={`container max-w-7xl mx-auto flex-1 px-safe pb-0 relative ${isMobile ? 'pt-[calc(env(safe-area-inset-top)+3.25rem)] pb-24' : 'pt-1 py-8 pb-8'}`}>
        {children}
      </main>
      
      {/* Footer - desktop only */}
      <footer className={`items-center justify-center py-6 border-t border-border/20 text-muted-foreground gap-3 ${isMobile ? 'hidden' : 'flex'}`}>
        <span className="text-sm">Powered by</span>
        <img src={crooLogo} alt="Croo" className="h-10 w-auto" />
      </footer>
      {!roleLoading && typeof document !== 'undefined' && createPortal(
        <nav className={`mobile-dock-container ${isMobile ? '' : 'hidden'}`}>
          {/* Dash/Org Bubble Popup - swaps based on current route */}
          {showOrgBubble && hasMultiLocationAccess && (
            <div className="absolute bottom-full left-3 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <button
                onClick={() => {
                  // Navigate to opposite view
                  navigate(location.pathname === '/org-dash' ? '/dashboard' : '/org-dash');
                  setShowOrgBubble(false);
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-background rounded-xl shadow-lg border border-border text-foreground font-medium"
              >
                {location.pathname === '/org-dash' ? (
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
          <DockContent 
            mobileMainNavItems={mobileMainNavItems}
            hasMultiLocationAccess={hasMultiLocationAccess}
            showOrgBubble={showOrgBubble}
            setShowOrgBubble={setShowOrgBubble}
            unreadCount={unreadCount}
            onSwipeUp={() => setShowCompactDashboard(true)}
            canViewSalesAndLabor={canViewSalesAndLabor}
            onOpenLocationPicker={(path) => { setPendingNavPath(path || null); setLocationDialogOpen(true); }}
          />
        </nav>,
        document.body
      )}


      {/* Compact Dashboard - Swipe Up from Dock (shift_manager+ only) */}
      {isMobile && canViewSalesAndLabor && (
        <CompactDashboard
          isExpanded={showCompactDashboard}
          onClose={() => setShowCompactDashboard(false)}
          onDragEnd={(info) => {
            // If dragged down more than 100px or with velocity, close it
            if (info.offset.y > 100 || info.velocity.y > 500) {
              setShowCompactDashboard(false);
            }
          }}
        />
      )}

      {/* Location Picker Dialog (opened from mobile nav) */}
      <LocationPickerDialog
        open={locationDialogOpen}
        onOpenChange={setLocationDialogOpen}
        currentLocationId={currentLocation?.id}
        onSelectLocation={(loc) => {
          setPendingNavPath(null);
          // Always force navigate when coming from org dash (even if same location)
          setCurrentLocation({
            id: loc.id,
            name: loc.name,
            location_type: loc.location_type,
            store_number: loc.store_number,
          }, '/dashboard', true);
        }}
      />

      {/* Location switch overlay — shown globally whenever a location is switching */}
      <LocationSwitchOverlay
        visible={isSwitching}
        locationName={switchingTo?.name ?? ''}
        storeNumber={switchingTo?.store_number}
        logoUrl={switchingTo?.id ? (localStorage.getItem(`brand-logo-${switchingTo.id}`) || orgLogo?.logo_url) : orgLogo?.logo_url}
        brandName={orgLogo?.brand_name ?? orgLogo?.name}
      />

      {/* AI Assistant floating bubble */}
      <AiAssistantBubble />

      {/* Onboarding Tour */}
      <OnboardingTour run={runTour} onComplete={completeTour} />

    </div>;
};
