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
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { MapPin, ExternalLink as ExternalLinkIcon, Thermometer, Shield, Wrench, GripVertical, ArrowUpDown, Building2 } from 'lucide-react';

import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { toast as sonnerToast } from 'sonner';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const themes = [
  { value: 'default', label: 'Default' },
  { value: 'oled', label: 'OLED Dark' },
  { value: 'earth', label: 'Warm Earth' },
  { value: 'ocean', label: 'Ocean Breeze' },
  { value: 'sage', label: 'Sage' },
  { value: 'lavender', label: 'Lavender' },
  { value: 'vibrant', label: 'Vibrant' },
];

const DEFAULT_SECTION_ORDER = ['theme', 'notifications', 'organizations', 'roles', 'maintenance'];
const STORAGE_KEY = 'settings-section-order';

interface SortableSectionProps {
  id: string;
  isEditMode: boolean;
  children: React.ReactNode;
}

function SortableSection({ id, isEditMode, children }: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {isEditMode && (
        <div
          {...attributes}
          {...listeners}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className={isEditMode ? 'pl-10' : ''}>{children}</div>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const { isChecklistOnlyLocation } = useAppLocation();
  const [theme, setTheme] = useState(localStorage.getItem('app-theme') || 'default');
  const [locations, setLocations] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const validSections = parsed.filter((id: string) => DEFAULT_SECTION_ORDER.includes(id));
      DEFAULT_SECTION_ORDER.forEach(id => {
        if (!validSections.includes(id)) validSections.push(id);
      });
      return validSections;
    }
    return DEFAULT_SECTION_ORDER;
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (isAdmin) {
      fetchLocations();
      fetchOrganizations();
    }
  }, [isAdmin]);

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
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      setOrganizations(data || []);
    } catch (error: any) {
      console.error('Error fetching organizations:', error);
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSectionOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrder));
        return newOrder;
      });
    }
  };

  const renderSectionContent = (sectionId: string) => {
    switch (sectionId) {
      case 'theme':
        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Theme</CardTitle>
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
        );

      case 'notifications':
        return <NotificationSettings />;

      case 'organizations':
        if (!isAdmin) return null;
        return (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  <CardTitle className="text-base">Organizations</CardTitle>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/organization/new')}
                >
                  <Building2 className="h-3 w-3 mr-1" />
                  Add Org
                </Button>
              </div>
              <CardDescription className="text-xs">
                Manage organizations and their locations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {organizations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No organizations yet
                </p>
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
                          <Building2 className="h-4 w-4" />
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
            </CardContent>
          </Card>
        );

      case 'roles':
        if (!isAdmin) return null;
        return (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <CardTitle className="text-base">Roles & Permissions</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Configure permissions, notifications, and positions
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
        );

      case 'maintenance':
        if (!isAdmin) return null;
        return (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
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
        );

      default:
        return null;
    }
  };

  // Filter visible sections based on role and location type
  const visibleSections = sectionOrder.filter(id => {
    // For checklist-only locations, show limited settings
    if (isChecklistOnlyLocation) {
      if (id === 'theme') return true;
      if (id === 'organizations' && isAdmin) return true;
      if (id === 'locations' && isAdmin) return true;
      if (id === 'maintenance' && isAdmin) return true;
      return false;
    }
    
    // Standard filtering for normal locations
    if (['organizations', 'roles', 'maintenance'].includes(id)) {
      return isAdmin;
    }
    return true;
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Manage your preferences</p>
          </div>
          {isAdmin && (
            <Button
              variant={isEditMode ? "default" : "outline"}
              size="sm"
              onClick={() => setIsEditMode(!isEditMode)}
            >
              <ArrowUpDown className="h-4 w-4 mr-2" />
              {isEditMode ? 'Done' : 'Reorder'}
            </Button>
          )}
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleSections} strategy={verticalListSortingStrategy}>
            <div className="grid gap-4">
              {visibleSections.map((sectionId) => {
                const content = renderSectionContent(sectionId);
                if (!content) return null;
                return (
                  <SortableSection key={sectionId} id={sectionId} isEditMode={isEditMode}>
                    {content}
                  </SortableSection>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </Layout>
  );
}
