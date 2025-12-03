import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { MapPin, ExternalLink as ExternalLinkIcon, Thermometer, Shield, Wrench, GripVertical } from 'lucide-react';
import { PositionManagementCompact } from '@/components/settings/PositionManagementCompact';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { toast as sonnerToast } from 'sonner';

const themes = [
  { value: 'default', label: 'Default' },
  { value: 'oled', label: 'OLED Black' },
  { value: 'blue', label: 'Ocean Blue' },
  { value: 'forest', label: 'Forest Green' },
  { value: 'sunset', label: 'Sunset Orange' },
];

// Section order stored in localStorage
const DEFAULT_SECTION_ORDER = ['theme', 'notifications', 'locations', 'roles', 'positions', 'maintenance'];

export default function Settings() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const [theme, setTheme] = useState(localStorage.getItem('app-theme') || 'default');
  const [locations, setLocations] = useState<any[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('settings-section-order');
    return saved ? JSON.parse(saved) : DEFAULT_SECTION_ORDER;
  });
  const [draggedSection, setDraggedSection] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (isAdmin) {
      fetchLocations();
    }
  }, [isAdmin]);

  const fetchLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name')
        .order('created_at', { ascending: true });

      if (error) throw error;
      setLocations(data || []);
    } catch (error: any) {
      console.error('Error fetching locations:', error);
    }
  };

  const handleThemeChange = (value: string) => {
    setTheme(value);
    localStorage.setItem('app-theme', value);
    document.documentElement.setAttribute('data-theme', value);
    toast({
      title: 'Theme Updated',
      description: 'Your theme preference has been saved.',
    });
  };

  const handleDragStart = (sectionId: string) => {
    setDraggedSection(sectionId);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedSection || draggedSection === targetId) return;

    const newOrder = [...sectionOrder];
    const draggedIndex = newOrder.indexOf(draggedSection);
    const targetIndex = newOrder.indexOf(targetId);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedSection);

    setSectionOrder(newOrder);
    localStorage.setItem('settings-section-order', JSON.stringify(newOrder));
  };

  const handleDragEnd = () => {
    setDraggedSection(null);
  };

  const renderSection = (sectionId: string) => {
    const dragProps = isAdmin ? {
      draggable: true,
      onDragStart: () => handleDragStart(sectionId),
      onDragOver: (e: React.DragEvent) => handleDragOver(e, sectionId),
      onDragEnd: handleDragEnd,
    } : {};

    switch (sectionId) {
      case 'theme':
        return (
          <div key="theme" {...dragProps} className={draggedSection === 'theme' ? 'opacity-50' : ''}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  {isAdmin && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />}
                  <CardTitle className="text-base">Theme</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="theme">Color Theme</Label>
                  <Select value={theme} onValueChange={handleThemeChange}>
                    <SelectTrigger id="theme">
                      <SelectValue placeholder="Select a theme" />
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
              </CardContent>
            </Card>
          </div>
        );

      case 'notifications':
        return (
          <div key="notifications" {...dragProps} className={`relative ${draggedSection === 'notifications' ? 'opacity-50' : ''}`}>
            {isAdmin && (
              <div className="absolute left-3 top-4 z-10">
                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
              </div>
            )}
            <NotificationSettings />
          </div>
        );

      case 'locations':
        if (!isAdmin || locations.length === 0) return null;
        return (
          <div key="locations" {...dragProps} className={draggedSection === 'locations' ? 'opacity-50' : ''}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                  <MapPin className="h-4 w-4" />
                  <CardTitle className="text-base">Locations</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Manage locations, hours, and timezone settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {locations.map((location) => (
                  <Button
                    key={location.id}
                    variant="outline"
                    className="w-full justify-between h-auto py-2"
                    onClick={() => navigate(`/location/${location.id}`)}
                  >
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3" />
                      <span className="text-sm">{location.name}</span>
                    </div>
                    <ExternalLinkIcon className="h-3 w-3" />
                  </Button>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => navigate('/location/new')}
                >
                  <MapPin className="h-3 w-3 mr-1" />
                  Add Location
                </Button>
              </CardContent>
            </Card>
          </div>
        );

      case 'roles':
        if (!isAdmin) return null;
        return (
          <div key="roles" {...dragProps} className={draggedSection === 'roles' ? 'opacity-50' : ''}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                  <Shield className="h-4 w-4" />
                  <CardTitle className="text-base">Role Management</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Configure permissions and notifications for each role
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate('/role-management')}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Manage Roles & Permissions
                </Button>
              </CardContent>
            </Card>
          </div>
        );

      case 'positions':
        if (!isAdmin) return null;
        return (
          <div key="positions" {...dragProps} className={draggedSection === 'positions' ? 'opacity-50' : ''}>
            <div className="relative">
              {isAdmin && (
                <div className="absolute left-3 top-4 z-10">
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                </div>
              )}
              <PositionManagementCompact />
            </div>
          </div>
        );

      case 'maintenance':
        if (!isAdmin) return null;
        return (
          <div key="maintenance" {...dragProps} className={draggedSection === 'maintenance' ? 'opacity-50' : ''}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                  <Wrench className="h-4 w-4" />
                  <CardTitle className="text-base">System Maintenance</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Admin tools and data management
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
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
                      sonnerToast.info('Starting photo completions backfill...');
                      const { data, error } = await supabase.functions.invoke('backfill-photo-completions');
                      
                      if (error) throw error;
                      
                      if (data.success) {
                        sonnerToast.success(`Backfill complete: ${data.updated} photo responses updated`);
                      } else {
                        sonnerToast.error(data.error || 'Backfill failed');
                      }
                    } catch (error: any) {
                      console.error('Backfill error:', error);
                      sonnerToast.error('Failed to run backfill');
                    }
                  }}
                >
                  Backfill Photo Completions
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={async () => {
                    try {
                      sonnerToast.info('Starting Croo Cash backfill...');
                      const { data, error } = await supabase.functions.invoke('backfill-croo-cash-transactions');
                      
                      if (error) throw error;
                      
                      if (data.success) {
                        sonnerToast.success(`Backfill complete: ${data.updated} transactions corrected`);
                      } else {
                        sonnerToast.error(data.error || 'Backfill failed');
                      }
                    } catch (error: any) {
                      console.error('Backfill error:', error);
                      sonnerToast.error('Failed to run backfill');
                    }
                  }}
                >
                  Backfill Croo Cash
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={async () => {
                    try {
                      sonnerToast.info('Rescanning temperatures...');
                      const { data, error } = await supabase.functions.invoke('rescan-temperatures');
                      
                      if (error) throw error;
                      
                      if (data.success) {
                        sonnerToast.success(`Rescan complete: ${data.updated} temperatures extracted`);
                      } else {
                        sonnerToast.error(data.error || 'Rescan failed');
                      }
                    } catch (error: any) {
                      console.error('Rescan error:', error);
                      sonnerToast.error('Failed to rescan');
                    }
                  }}
                >
                  Rescan Temperatures
                </Button>
              </CardContent>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Manage your preferences
            {isAdmin && <span className="text-xs ml-2">(drag sections to reorder)</span>}
          </p>
        </div>

        <div className="grid gap-4">
          {sectionOrder.map((sectionId) => renderSection(sectionId))}
        </div>
      </div>
    </Layout>
  );
}
