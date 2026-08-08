import { Layout } from '@/components/Layout';
import { PageTitle } from '@/components/PageTitle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserRole } from '@/hooks/useUserRole';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { supabase } from '@/integrations/supabase/client';
import { FEATURE_FLAGS } from '@/config/featureFlags';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Thermometer, Wrench, Building2, Tag, FlaskConical, ChevronDown, Palette, Bell, Package, Sparkles, ShieldCheck, ChevronRight, CreditCard, Copy, Monitor, Radio, Loader2, FileText } from 'lucide-react';
import { openDiagnosticMode } from '@/components/DiagnosticMode';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { syncChromeColor } from '@/utils/syncChrome';

// Lazy-load heavy sub-panels — only fetched when their section is opened.
// Prior to this, all panels (~5,000+ lines combined) shipped in the Settings chunk.
const UnifiedNotificationSettings = lazy(() =>
  import('@/components/settings/UnifiedNotificationSettings').then(m => ({ default: m.UnifiedNotificationSettings }))
);
const OrganizationMembersSection = lazy(() =>
  import('@/components/settings/OrganizationMembersSection').then(m => ({ default: m.OrganizationMembersSection }))
);
const RoleManagementSection = lazy(() =>
  import('@/components/settings/RoleManagementSection').then(m => ({ default: m.RoleManagementSection }))
);
const PositionManagementInline = lazy(() =>
  import('@/components/settings/PositionManagementInline').then(m => ({ default: m.PositionManagementInline }))
);
const LocationAuditsSection = lazy(() =>
  import('@/components/settings/LocationAuditsSection').then(m => ({ default: m.LocationAuditsSection }))
);
const CloneLocationSettings = lazy(() =>
  import('@/components/settings/CloneLocationSettings').then(m => ({ default: m.CloneLocationSettings }))
);
const DataStreamStatus = lazy(() =>
  import('@/components/settings/DataStreamStatus').then(m => ({ default: m.DataStreamStatus }))
);
const PinMigrationHealthPanel = lazy(() =>
  import('@/components/users/PinMigrationHealthPanel').then(m => ({ default: m.PinMigrationHealthPanel }))
);

const PanelFallback = () => (
  <div className="flex items-center justify-center py-8">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);

type ThemeOption = { value: string; label: string; brand?: string };
const themes: ThemeOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'oled', label: 'Dark Mode' },
  { value: 'earth', label: 'Warm Earth' },
  { value: 'beach', label: 'Beach' },
  { value: 'cupcake', label: 'Cupcake' },
  { value: 'blaze', label: 'Blaze Pizza', brand: 'blaze pizza' },
  { value: 'playa', label: 'Playa Bowls', brand: 'playa bowls' },
];

// Themes scoped to a specific brand only show for that brand's stores.
// Super admins (no currentLocation context) see all themes.
function filterThemesForBrand(brandName?: string | null): ThemeOption[] {
  const normalized = (brandName || '').trim().toLowerCase();
  return themes.filter((t) => !t.brand || t.brand === normalized);
}

const textSizes = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'extra-large', label: 'Extra Large' },
];

// Sections that belong to the location tab
const LOCATION_SECTIONS = ['theme', 'notifications', 'food-safety-audits', 'inventory', 'punch-clock', 'kds-board', 'location-profile'];
// Sections that belong to the org tab
const ORG_SECTIONS = ['billing', 'reporting', 'org-members', 'org-roles'];
// Sections only super admins see
const SUPER_ADMIN_SECTIONS = ['pin-migration', 'plan-catalogs', 'brands', 'organizations', 'maintenance'];

const SECTION_TITLES: Record<string, { title: string; icon: React.ReactNode }> = {
  billing: { title: 'Plans & Billing', icon: <CreditCard className="h-4 w-4" /> },
  reporting: { title: 'Reporting', icon: <FileText className="h-4 w-4" /> },
  theme: { title: 'Theme', icon: <Palette className="h-4 w-4" /> },
  notifications: { title: 'Notifications', icon: <Bell className="h-4 w-4" /> },
  'food-safety-audits': { title: 'Audit Results', icon: <ShieldCheck className="h-4 w-4" /> },
  'location-profile': { title: 'Edit Location Settings', icon: <Building2 className="h-4 w-4" /> },
  inventory: { title: 'Inventory', icon: <Package className="h-4 w-4" /> },
  'punch-clock': { title: 'Customize Punch Clock', icon: <Sparkles className="h-4 w-4" /> },
  'kds-board': { title: 'Live KDS Board', icon: <Monitor className="h-4 w-4" /> },
  'org-members': { title: 'Org Admins', icon: <Building2 className="h-4 w-4" /> },
  'org-roles': { title: 'Roles & Permissions', icon: <Building2 className="h-4 w-4" /> },
  'org-positions': { title: 'Positions', icon: <Building2 className="h-4 w-4" /> },
  'plan-catalogs': { title: 'Plan Catalogs', icon: <CreditCard className="h-4 w-4" /> },
  brands: { title: 'Brands', icon: <Tag className="h-4 w-4" /> },
  organizations: { title: 'All Organizations', icon: <Building2 className="h-4 w-4" /> },
  maintenance: { title: 'System Maintenance', icon: <Wrench className="h-4 w-4" /> },
  'pin-migration': { title: 'PIN Migration Health', icon: <ShieldCheck className="h-4 w-4" /> },
};

export default function Settings() {
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin, isOrgAdmin, isBrandAdmin, isShiftManager, isManager, role } = useUserRole();
  const { hasPermission } = useRolePermissions();
  const { isChecklistOnlyLocation, currentLocation, organizationId } = useAppLocation();
  const [theme, setTheme] = useState(localStorage.getItem('app-theme') || 'default');
  const [textSize, setTextSize] = useState(localStorage.getItem('app-text-size') || 'default');
  const [locations, setLocations] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'location' | 'org' | 'super'>('location');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    theme: false,
    notifications: false,
    'food-safety-audits': false,
    inventory: false,
    'punch-clock': false,
    'org-members': true,
    'org-roles': false,
    'org-positions': false,
    'clone-settings': false,
    brands: false,
    organizations: false,
    maintenance: false,
  });

  // Who sees the pill selector: org_admin, brand_admin, super_admin
  const showPillSelector = isOrgAdmin || isBrandAdmin || isSuperAdmin;

  const toggleSection = (sectionId: string) => {
    setOpenSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    syncChromeColor();
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-text-size', textSize);
  }, [textSize]);

  useEffect(() => {
    if (isAdmin || isOrgAdmin || isBrandAdmin || isSuperAdmin) {
      fetchLocations();
      fetchOrganizations();
    }
  }, [isAdmin, isOrgAdmin, isBrandAdmin, isSuperAdmin]);

  const fetchLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, organization_id')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setLocations(data || []);
    } catch (error: any) {
      console.error('Error fetching locations:', error);
    }
  };

  const fetchOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('*, brands(name, logo_url)')
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      const orgsWithLogos = (data || []).map((org: any) => ({
        ...org,
        display_logo: org.logo_url || org.brands?.logo_url || null,
      }));
      setOrganizations(orgsWithLogos);
    } catch (error: any) {
      console.error('Error fetching organizations:', error);
    }
  };

  const handleThemeChange = (value: string) => {
    setTheme(value);
    localStorage.setItem('app-theme', value);
    document.documentElement.setAttribute('data-theme', value);
    syncChromeColor();
    toast('Theme updated');
  };



  const handleTextSizeChange = (value: string) => {
    setTextSize(value);
    localStorage.setItem('app-text-size', value);
    document.documentElement.setAttribute('data-text-size', value);
    toast('Text size updated');
  };

  // Pill label helpers
  const locationLabel = currentLocation?.name || 'Location';
  // Org must follow the CURRENT location — never fall back to a different org,
  // otherwise multi-brand admins see the previous brand's organization here.
  const currentOrgId = (currentLocation as any)?.organization_id || (currentLocation ? undefined : organizationId);
  const currentOrg = currentOrgId ? organizations.find(o => o.id === currentOrgId) : undefined;
  const orgLabel = currentOrg?.name || 'Organization';


  // Pre-flight check used to decide whether the section card should render at all.
  // Mirrors the early `return null` cases inside renderSectionContent so we can
  // avoid mounting heavy panels until the user actually opens the section.
  const isSectionAvailable = (sectionId: string): boolean => {
    switch (sectionId) {
      case 'inventory':
      case 'punch-clock':
        return false; // rendered as nav-link buttons elsewhere
      case 'food-safety-audits':
        return !!currentLocation;
      case 'org-members':
      case 'org-roles':
      case 'org-positions':
        return !!currentOrgId;
      case 'clone-settings':
      case 'brands':
      case 'organizations':
        return isSuperAdmin;
      case 'maintenance':
        return isAdmin;
      default:
        return true;
    }
  };

  const renderSectionContent = (sectionId: string): React.ReactNode => {
    switch (sectionId) {
      case 'food-safety-audits':
        if (!currentLocation) return null;
        return <LocationAuditsSection locationId={currentLocation.id} locationName={currentLocation.name} />;

      case 'inventory':
        return null; // rendered directly in the map as a button card

      case 'punch-clock':
        return null; // rendered directly in the map as a button card

      case 'org-members':
        if (!currentOrgId) return null;
        return <OrganizationMembersSection organizationId={currentOrgId} />;

      case 'org-roles':
        if (!currentOrgId) return null;
        return <RoleManagementSection organizationId={currentOrgId} />;

      case 'org-positions':
        if (!currentOrgId) return null;
        return <PositionManagementInline organizationId={currentOrgId} />;

      case 'theme':
        {
          const availableThemes = filterThemesForBrand(currentLocation?.brand_name);
          const effectiveTheme = availableThemes.some((t) => t.value === theme) ? theme : 'default';
          return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="theme">Color Theme</Label>
              <Select value={effectiveTheme} onValueChange={handleThemeChange}>
                <SelectTrigger id="theme">
                  <SelectValue placeholder="Select a theme" />
                </SelectTrigger>
                <SelectContent>
                  {availableThemes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="text-size">Text Size</Label>
              <Select value={textSize} onValueChange={handleTextSizeChange}>
                <SelectTrigger id="text-size">
                  <SelectValue placeholder="Select text size" />
                </SelectTrigger>
                <SelectContent>
                  {textSizes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Adjust text size across the app</p>
            </div>
          </div>
        );
        }



      case 'notifications':
        return <UnifiedNotificationSettings />;

      case 'clone-settings':
        if (!isSuperAdmin) return null;
        return <CloneLocationSettings />;

      case 'brands':
        if (!isSuperAdmin) return null;
        return (
          <div className="space-y-3">
            <CardDescription className="text-xs">Create and manage franchise brands</CardDescription>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/brands')}>
                <Tag className="h-3 w-3 mr-1" />
                Manage Brands
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/brand/5f805404-cc7b-454b-a994-fe5901c32e6a/inventory')}>
                <Package className="h-3 w-3 mr-1" />
                Blaze Inventory
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/brand/164ed861-d3bd-426d-8993-0403aa390634/inventory')}>
                <Package className="h-3 w-3 mr-1" />
                BWW GO Inventory
              </Button>
            </div>
          </div>
        );

      case 'organizations':
        if (!isSuperAdmin) return null;
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs">Manage organizations and their locations</CardDescription>
              <Button variant="outline" size="sm" onClick={() => navigate('/organization/new')}>
                <Building2 className="h-3 w-3 mr-1" />
                Add Org
              </Button>
            </div>
            {organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">No organizations yet</p>
            ) : (
              organizations.map((org) => {
                const orgLocations = locations.filter(l => l.organization_id === org.id);
                return (
                  <div key={org.id} className="space-y-2 p-3 border rounded-lg">
                    <Button
                      variant="ghost"
                      className="w-full justify-between h-auto py-1 px-2 -mx-2"
                      onClick={() => navigate(`/organization/${org.id}`)}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        {org.display_logo ? (
                          <img src={org.display_logo} alt="" className="h-4 w-4 object-contain rounded" />
                        ) : (
                          <Building2 className="h-4 w-4" />
                        )}
                        {org.name}
                      </div>
                    </Button>
                    <div className="space-y-1">
                      {orgLocations.map((location) => (
                        <Button
                          key={location.id}
                          variant="outline"
                          size="sm"
                          className="w-full justify-between h-auto py-2"
                          onClick={() => navigate(`/location/${location.id}`)}
                        >
                          <span className="text-xs">{location.name}</span>
                        </Button>
                      ))}
                      {orgLocations.length === 0 && (
                        <p className="text-xs text-muted-foreground pl-2">No locations</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );

      case 'maintenance':
        if (!isAdmin) return null;
        return (
          <div className="space-y-3">
            <CardDescription className="text-xs">Admin tools and data management</CardDescription>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => navigate('/temperature-validation')}
            >
              <Thermometer className="w-4 h-4 mr-2" />
              Temperature Validation
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={async () => {
                try {
                  toast.info('Rescanning temperatures...');
                  const { data, error } = await supabase.functions.invoke('ai-extraction-service?action=rescan-temperatures');
                  if (error) throw error;
                  if (data.success) {
                    toast.success(`Rescan complete: ${data.updated} temperatures extracted`);
                  } else {
                    toast.error(data.error || 'Rescan failed');
                  }
                } catch (error: any) {
                  console.error('Rescan error:', error);
                  toast.error('Failed to rescan');
                }
              }}
            >
              Rescan Temperatures
            </Button>
            {isSuperAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => openDiagnosticMode()}
              >
                <FlaskConical className="w-4 h-4 mr-2" />
                Diagnostics
              </Button>
            )}
            {isSuperAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => navigate('/alerts')}
              >
                <Radio className="w-4 h-4 mr-2" />
                Live Alerts
              </Button>
            )}
            {isSuperAdmin && (
              <div className="pt-3 border-t space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Radio className="h-3 w-3" /> Data Streams
                </div>
                <DataStreamStatus />
              </div>
            )}
            {isSuperAdmin && (
              <div className="pt-3 border-t space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Copy className="h-3 w-3" /> Clone Location Settings
                </div>
                <CloneLocationSettings />
              </div>
            )}
          </div>
        );

      case 'pin-migration':
        if (!isSuperAdmin) return null;
        return <PinMigrationHealthPanel />;


      default:
        return null;
    }
  };

  // Determine which sections are visible based on role, location type, and active tab
  const getSectionsForTab = (tab: 'location' | 'org' | 'super') => {
    if (tab === 'super') {
      return SUPER_ADMIN_SECTIONS.filter(() => isSuperAdmin);
    }
    const pool = tab === 'location' ? LOCATION_SECTIONS : ORG_SECTIONS;

    return pool.filter(id => {
      if (id === 'food-safety-audits') return !!currentLocation && (isAdmin || isOrgAdmin || isBrandAdmin || isSuperAdmin);
      if (id === 'location-profile') return !!currentLocation && (isAdmin || isOrgAdmin || isBrandAdmin || isSuperAdmin);
      if (id === 'inventory') return !!currentLocation && !isChecklistOnlyLocation && (isAdmin || isOrgAdmin || isBrandAdmin || isSuperAdmin || hasPermission('manage_inventory'));
      if (id === 'punch-clock') return !!currentLocation && !isChecklistOnlyLocation && (isAdmin || isOrgAdmin || isBrandAdmin || isSuperAdmin);
      if (id === 'kds-board') return FEATURE_FLAGS.KDS_ENABLED && isSuperAdmin;
      if (id === 'billing') return !!currentOrgId && (isOrgAdmin || isBrandAdmin || isSuperAdmin);
      if (id === 'reporting') return !!currentOrgId && (isOrgAdmin || isBrandAdmin || isSuperAdmin);
      if (id === 'org-members') return !!currentOrgId && (isOrgAdmin || isBrandAdmin || isSuperAdmin);
      if (id === 'org-roles') return !!currentOrgId && (isOrgAdmin || isBrandAdmin || isSuperAdmin);
      if (id === 'org-positions') return !!currentOrgId && (isOrgAdmin || isBrandAdmin || isSuperAdmin);
      return true;
    });
  };

  const visibleSections = getSectionsForTab(activeTab);

  return (
    <Layout>
      <div className="space-y-4 w-full">
        <div>
          <PageTitle color="slate">Settings</PageTitle>
          <p className="text-muted-foreground">Manage your preferences</p>
        </div>

        {/* Pill selector — only for org_admin and above */}
        {showPillSelector && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'location' | 'org' | 'super')} className="w-full">
            <TabsList className={`w-full grid ${isSuperAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <TabsTrigger value="location">{locationLabel}</TabsTrigger>
              <TabsTrigger value="org">{orgLabel}</TabsTrigger>
              {isSuperAdmin && <TabsTrigger value="super">Super Admin</TabsTrigger>}
            </TabsList>
          </Tabs>
        )}

        <div className="grid gap-3 w-full">
          {visibleSections.map((sectionId) => {
            const sectionInfo = SECTION_TITLES[sectionId];

            // Nav-link rows — same card style as collapsibles but navigate on click
            const navLinks: Record<string, () => void> = {
              'location-profile': () => navigate(`/location/${currentLocation?.id}`),
              'inventory': () => navigate(`/inventory/${currentLocation?.id}`),
              'punch-clock': () => navigate(`/location/${currentLocation?.id}/punch-clock`),
              'billing': () => navigate('/billing'),
              'reporting': () => navigate('/reporting'),
              'kds-board': () => navigate('/kds'),
              'plan-catalogs': () => navigate('/super-admin/plans'),
            };

            if (navLinks[sectionId]) {
              return (
                <button
                  key={sectionId}
                  onClick={navLinks[sectionId]}
                  className="w-full flex items-center justify-between px-4 py-4 rounded-xl bg-primary text-primary-foreground active:scale-[0.98] transition-all duration-150 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="opacity-80">{sectionInfo.icon}</span>
                    <span className="font-semibold text-base">{sectionInfo.title}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-60" />
                </button>
              );
            }



            // Skip rendering the card for sections that aren't available in this context
            // (e.g., super-admin-only sections for non-admins, org sections without an org).
            if (!isSectionAvailable(sectionId)) return null;

            const isOpen = !!openSections[sectionId];

            // Sections that have their own internal cards — render flush to avoid nesting
            const isFlushSection = ['food-safety-audits', 'notifications', 'org-members', 'org-roles', 'org-positions', 'clone-settings'].includes(sectionId);

            return (
              <Collapsible
                key={sectionId}
                open={isOpen}
                onOpenChange={() => toggleSection(sectionId)}
                className="w-full min-w-0"
              >
                <Card className="w-full min-w-0 overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {sectionInfo.icon}
                          <CardTitle className="text-base truncate">{sectionInfo.title}</CardTitle>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {/* Only mount the panel after the user opens it. This prevents
                        heavy children (LocationAuditsSection, UnifiedNotificationSettings,
                        etc.) from fetching data and running effects while collapsed. */}
                    {isOpen && (
                      <Suspense fallback={<PanelFallback />}>
                        {isFlushSection ? (
                          <div className="px-4 pb-4 pt-0 min-w-0 overflow-hidden">{renderSectionContent(sectionId)}</div>
                        ) : (
                          <CardContent className="pt-0 min-w-0 overflow-hidden">{renderSectionContent(sectionId)}</CardContent>
                        )}
                      </Suspense>
                    )}
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}

          {activeTab === 'org' && currentOrgId && (isOrgAdmin || isBrandAdmin || isSuperAdmin) && (
            <button
              onClick={() => navigate(`/organization/${currentOrgId}`)}
              className="w-full flex items-center justify-between px-4 py-4 rounded-xl bg-primary text-primary-foreground active:scale-[0.98] transition-all duration-150 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 opacity-80" />
                <span className="font-semibold text-base">Edit Org Settings</span>
              </div>
              <ChevronRight className="h-4 w-4 opacity-60" />
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}
