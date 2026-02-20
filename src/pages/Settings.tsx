import { Layout } from '@/components/Layout';
import { PageHeaderDivider } from '@/components/ui/page-header-divider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { MapPin, ExternalLink as ExternalLinkIcon, Thermometer, Wrench, Building2, Tag, FlaskConical, ChevronDown, Palette, Bell } from 'lucide-react';
import { openDiagnosticMode } from '@/components/DiagnosticMode';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnifiedNotificationSettings } from '@/components/settings/UnifiedNotificationSettings';

const themes = [
  { value: 'default', label: 'Default' },
  { value: 'oled', label: 'Dark Knight' },
  { value: 'earth', label: 'Warm Earth' },
  { value: 'ocean', label: 'Ocean Breeze' },
  { value: 'sage', label: 'Sage' },
  { value: 'lavender', label: 'Lavender' },
  { value: 'vibrant', label: 'Vibrant' },
  { value: 'blaze', label: 'Blaze Pizza' },
];

const textSizes = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'extra-large', label: 'Extra Large' },
];

// Sections that belong to the location tab
const LOCATION_SECTIONS = ['theme', 'notifications'];
// Sections that belong to the org tab
const ORG_SECTIONS = ['brands', 'organizations', 'maintenance'];

const SECTION_TITLES: Record<string, { title: string; icon: React.ReactNode }> = {
  theme: { title: 'Theme', icon: <Palette className="h-4 w-4" /> },
  notifications: { title: 'Notifications', icon: <Bell className="h-4 w-4" /> },
  brands: { title: 'Brands', icon: <Tag className="h-4 w-4" /> },
  organizations: { title: 'Organizations', icon: <Building2 className="h-4 w-4" /> },
  maintenance: { title: 'System Maintenance', icon: <Wrench className="h-4 w-4" /> },
};

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isSuperAdmin, isOrgAdmin, isBrandAdmin } = useUserRole();
  const { isChecklistOnlyLocation, currentLocation, organizationId } = useAppLocation();
  const [theme, setTheme] = useState(localStorage.getItem('app-theme') || 'default');
  const [textSize, setTextSize] = useState(localStorage.getItem('app-text-size') || 'default');
  const [locations, setLocations] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'location' | 'org'>('location');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    theme: true,
    notifications: false,
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
    toast('Theme updated');
  };

  const handleTextSizeChange = (value: string) => {
    setTextSize(value);
    localStorage.setItem('app-text-size', value);
    document.documentElement.setAttribute('data-text-size', value);
    toast('Text size updated');
  };

  const renderSectionContent = (sectionId: string) => {
    switch (sectionId) {
      case 'theme':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="theme">Color Theme</Label>
              <Select value={theme} onValueChange={handleThemeChange}>
                <SelectTrigger id="theme">
                  <SelectValue placeholder="Select a theme" />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
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

      case 'notifications':
        return <UnifiedNotificationSettings />;

      case 'brands':
        if (!isSuperAdmin) return null;
        return (
          <div className="space-y-3">
            <CardDescription className="text-xs">Create and manage franchise brands</CardDescription>
            <Button variant="outline" size="sm" onClick={() => navigate('/brands')}>
              <Tag className="h-3 w-3 mr-1" />
              Manage Brands
            </Button>
          </div>
        );

      case 'organizations':
        if (!isAdmin && !isOrgAdmin) return null;
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
                      <ExternalLinkIcon className="h-3 w-3" />
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
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3 w-3" />
                            <span className="text-xs">{location.name}</span>
                          </div>
                          <ExternalLinkIcon className="h-3 w-3" />
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
          </div>
        );

      default:
        return null;
    }
  };

  // Determine which sections are visible based on role, location type, and active tab
  const getSectionsForTab = (tab: 'location' | 'org') => {
    const pool = tab === 'location' ? LOCATION_SECTIONS : ORG_SECTIONS;

    return pool.filter(id => {
      if (isChecklistOnlyLocation) {
        if (id === 'theme') return true;
        if (id === 'notifications') return true;
        if (id === 'organizations' && isAdmin) return true;
        if (id === 'maintenance' && isAdmin) return true;
        return false;
      }
      if (id === 'brands') return isSuperAdmin;
      if (id === 'organizations') return isAdmin || isOrgAdmin;
      if (id === 'maintenance') return isAdmin;
      return true;
    });
  };

  // Pill label helpers
  const locationLabel = currentLocation?.name ? `${currentLocation.name} Settings` : 'Location Settings';
  const currentOrg = organizations.find(o => o.id === organizationId) ?? organizations[0];
  const orgLabel = currentOrg ? `${currentOrg.name} Settings` : 'Org Settings';

  const visibleSections = getSectionsForTab(activeTab);

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your preferences</p>
          <PageHeaderDivider />
        </div>

        {/* Pill selector — only for org_admin and above */}
        {showPillSelector && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'location' | 'org')} className="w-full">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="location">{locationLabel}</TabsTrigger>
              <TabsTrigger value="org">{orgLabel}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="grid gap-3">
          {visibleSections.map((sectionId) => {
            const content = renderSectionContent(sectionId);
            if (!content) return null;
            const sectionInfo = SECTION_TITLES[sectionId];

            return (
              <Collapsible
                key={sectionId}
                open={openSections[sectionId]}
                onOpenChange={() => toggleSection(sectionId)}
              >
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {sectionInfo.icon}
                          <CardTitle className="text-base">{sectionInfo.title}</CardTitle>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                            openSections[sectionId] ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0">
                      {content}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
