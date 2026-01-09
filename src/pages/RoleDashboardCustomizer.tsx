import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Plus, Trash2, Check, Box, LineChart, LayoutGrid, Minus, Save, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { MetricType, METRIC_CONFIGS, METRIC_GROUPS, WidgetSize, SalesDataForWidgets } from '@/components/dashboard/DashboardWidget';
import { CubeType } from '@/components/dashboard/AddWidgetDialog';
import { DataCube3D } from '@/components/dashboard/DataCube3D';
import { DashboardWidget } from '@/components/dashboard/DashboardWidget';
import { SalesOverview } from '@/components/dashboard/SalesOverview';
import { THEME_COLORS, ThemeColorKey, getThemeColorClass, isThemeColorKey } from '@/utils/themeColors';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

interface CubeConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  cubeType: CubeType | 'data-3d';
  faceMetrics?: MetricType[][];
  faceTitles?: string[];
  numFaces?: number;
}

const ROLE_LABELS: Record<string, string> = {
  team_member: 'Team Member',
  shift_manager: 'Shift Manager',
  manager: 'Manager',
  general_manager: 'General Manager',
};

export default function RoleDashboardCustomizer() {
  const navigate = useNavigate();
  const { organizationId } = useParams<{ organizationId: string }>();
  const [searchParams] = useSearchParams();
  const role = searchParams.get('role') || 'team_member';
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [cubes, setCubes] = useState<CubeConfig[]>([]);
  const [selectedCubeIndex, setSelectedCubeIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  // 3D cube editing state
  const [activeFace, setActiveFace] = useState(0);
  const [faceMetrics, setFaceMetrics] = useState<MetricType[][]>([[], [], [], []]);
  const [faceTitles, setFaceTitles] = useState<string[]>(['', '', '', '']);
  const [numFaces, setNumFaces] = useState(2);
  
  // Preview state (mock sales data matching SalesDataForWidgets interface)
  const [previewSalesData] = useState<SalesDataForWidgets>({
    daily: 3245.67,
    weekly: 18456.78,
    monthly: 72345.89,
    guestCount: { daily: 142, weekly: 823, monthly: 3245 },
    pizzaCount: { daily: 287, weekly: 1654, monthly: 6523 },
    avgTicket: 22.86,
    comparison: { 
      prevDay: 3012.45, 
      prevDayFullDay: 3012.45, 
      prevWeek: 17890.23, 
      prevWeekFullWeek: 17890.23, 
      prevMonth: 68923.45, 
      prevMonthFullMonth: 68923.45 
    },
    lastYear: { sameDay: 2890.12, sameWeek: 16543.21, sameMonth: 65432.10 },
    projections: { 
      todayProjected: 5890.00, 
      todayPaceAdjusted: 4125.00, 
      weekProjected: 32100.00, 
      weekPaceAdjusted: 28500.00, 
      monthProjected: 112000.00, 
      monthPaceAdjusted: 98000.00 
    },
    labor: { laborPercent: 24.5, laborCost: 795.19, hoursWorked: 45.2 },
    weeklyLabor: { laborPercent: 23.8, laborCost: 4392.51, hoursWorked: 256.4 },
    monthlyLabor: { laborPercent: 24.1, laborCost: 17435.24, hoursWorked: 1023.6 },
  });

  // Fetch existing role cubes config
  const { data: existingConfig, isLoading } = useQuery({
    queryKey: ['role-dashboard-cubes-config', organizationId, role],
    queryFn: async () => {
      if (!organizationId) return null;
      
      const { data, error } = await supabase
        .from('role_dashboard_cubes')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('role', role)
        .maybeSingle();
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching role cubes config:', error);
        return null;
      }
      
      return data;
    },
    enabled: !!organizationId,
  });

  // Initialize cubes from existing config
  useEffect(() => {
    if (existingConfig?.cubes) {
      const loadedCubes = (existingConfig.cubes as any[]).map((cube, index) => ({
        id: cube.id || `cube-${index}`,
        title: cube.title || '',
        size: (cube.size as WidgetSize) || 'small',
        metrics: (cube.metrics as MetricType[]) || [],
        accentColor: cube.accentColor || '#8B5CF6',
        cubeType: (cube.cubeType as CubeType | 'data-3d') || 'data-3d',
        faceMetrics: (cube.faceMetrics as MetricType[][]) || [],
        faceTitles: (cube.faceTitles as string[]) || [],
        numFaces: cube.numFaces || 1,
      }));
      setCubes(loadedCubes);
    }
  }, [existingConfig]);

  const selectedCube = selectedCubeIndex !== null ? cubes[selectedCubeIndex] : null;

  // Load cube data into editing state when selected
  useEffect(() => {
    if (selectedCube?.cubeType === 'data-3d') {
      setFaceMetrics([
        selectedCube.faceMetrics?.[0] || [],
        selectedCube.faceMetrics?.[1] || [],
        selectedCube.faceMetrics?.[2] || [],
        selectedCube.faceMetrics?.[3] || [],
      ]);
      setFaceTitles([
        selectedCube.faceTitles?.[0] || '',
        selectedCube.faceTitles?.[1] || '',
        selectedCube.faceTitles?.[2] || '',
        selectedCube.faceTitles?.[3] || '',
      ]);
      setNumFaces(selectedCube.numFaces || 2);
      setActiveFace(0);
    }
  }, [selectedCubeIndex]);

  const handleAddCube = (type: 'data-3d' | 'sales-chart') => {
    const newCube: CubeConfig = {
      id: `new-${Date.now()}`,
      title: type === 'sales-chart' ? 'Sales Overview' : '',
      size: 'small',
      metrics: [],
      accentColor: THEME_COLORS[cubes.length % THEME_COLORS.length].key,
      cubeType: type,
      faceMetrics: [[], [], [], []],
      faceTitles: ['', '', '', ''],
      numFaces: 2,
    };
    setCubes([...cubes, newCube]);
    setSelectedCubeIndex(cubes.length);
    setHasChanges(true);
  };

  const handleDeleteCube = (index: number) => {
    const newCubes = cubes.filter((_, i) => i !== index);
    setCubes(newCubes);
    if (selectedCubeIndex === index) {
      setSelectedCubeIndex(null);
    } else if (selectedCubeIndex !== null && selectedCubeIndex > index) {
      setSelectedCubeIndex(selectedCubeIndex - 1);
    }
    setHasChanges(true);
  };

  const updateSelectedCube = (updates: Partial<CubeConfig>) => {
    if (selectedCubeIndex === null) return;
    const newCubes = [...cubes];
    newCubes[selectedCubeIndex] = { ...newCubes[selectedCubeIndex], ...updates };
    setCubes(newCubes);
    setHasChanges(true);
  };

  const toggleMetric = (metric: MetricType) => {
    if (!selectedCube || selectedCube.cubeType !== 'data-3d') return;
    
    const currentFaceMetrics = faceMetrics[activeFace];
    const maxMetrics = 4;
    
    let updated: MetricType[][];
    if (currentFaceMetrics.includes(metric)) {
      updated = [...faceMetrics];
      updated[activeFace] = currentFaceMetrics.filter(m => m !== metric);
    } else if (currentFaceMetrics.length < maxMetrics) {
      updated = [...faceMetrics];
      updated[activeFace] = [...currentFaceMetrics, metric];
    } else {
      return;
    }
    
    setFaceMetrics(updated);
    updateSelectedCube({
      faceMetrics: updated.slice(0, numFaces),
      faceTitles: faceTitles.slice(0, numFaces),
      numFaces,
    });
  };

  const updateFaceTitle = (idx: number, title: string) => {
    const updated = [...faceTitles];
    updated[idx] = title;
    setFaceTitles(updated);
    updateSelectedCube({
      faceTitles: updated.slice(0, numFaces),
    });
  };

  const updateNumFaces = (n: number) => {
    setNumFaces(n);
    if (activeFace >= n) setActiveFace(n - 1);
    updateSelectedCube({
      numFaces: n,
      faceMetrics: faceMetrics.slice(0, n),
      faceTitles: faceTitles.slice(0, n),
    });
  };

  const isMetricUsedElsewhere = (metric: MetricType) => {
    return faceMetrics.some((face, idx) => idx !== activeFace && idx < numFaces && face.includes(metric));
  };

  const handleSave = async () => {
    if (!organizationId || !user?.id) return;
    
    setIsSaving(true);
    try {
      // Prepare cubes data for storage
      const cubesData = cubes.map(cube => ({
        id: cube.id,
        title: cube.title,
        size: cube.size,
        metrics: cube.metrics,
        accentColor: cube.accentColor,
        cubeType: cube.cubeType,
        faceMetrics: cube.faceMetrics,
        faceTitles: cube.faceTitles,
        numFaces: cube.numFaces,
      }));
      
      // Upsert the role config
      const { error } = await supabase
        .from('role_dashboard_cubes')
        .upsert({
          organization_id: organizationId,
          role: role,
          cubes: cubesData,
          created_by: user.id,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'organization_id,role',
        });
      
      if (error) throw error;
      
      toast.success(`Dashboard saved for ${ROLE_LABELS[role]}`);
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['role-dashboard-cubes'] });
    } catch (error) {
      console.error('Error saving role cubes:', error);
      toast.error('Failed to save dashboard configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const hasSalesChart = cubes.some(c => c.cubeType === 'sales-chart');

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-card px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold">{ROLE_LABELS[role]} Dashboard</h1>
            <p className="text-xs text-muted-foreground">Configure what this role sees on their dashboard</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Configuration Panel */}
        <div className="w-80 border-r bg-card flex flex-col">
          {/* Cubes List */}
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">Widgets</h3>
              <div className="flex gap-1">
                {!hasSalesChart && (
                  <Button variant="outline" size="sm" onClick={() => handleAddCube('sales-chart')}>
                    <LineChart className="h-3 w-3 mr-1" />
                    Chart
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => handleAddCube('data-3d')}>
                  <Box className="h-3 w-3 mr-1" />
                  3D Cube
                </Button>
              </div>
            </div>
            
            <ScrollArea className="h-40">
              <div className="space-y-2">
                {cubes.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No widgets yet. Add a 3D Cube or Sales Chart.
                  </p>
                ) : (
                  cubes.map((cube, index) => (
                    <div
                      key={cube.id}
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        selectedCubeIndex === index ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                      }`}
                      onClick={() => setSelectedCubeIndex(index)}
                    >
                      <div 
                        className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: isThemeColorKey(cube.accentColor) ? `hsl(var(--${cube.accentColor}))` : cube.accentColor }}
                      >
                        {cube.cubeType === 'sales-chart' ? (
                          <LineChart className="h-4 w-4 text-white" />
                        ) : (
                          <Box className="h-4 w-4 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {cube.cubeType === 'sales-chart' ? 'Sales Overview' : '3D Cube'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {cube.cubeType === 'sales-chart' 
                            ? 'Full chart' 
                            : `${cube.numFaces || 1} face${(cube.numFaces || 1) > 1 ? 's' : ''}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCube(index);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Cube Editor */}
          {selectedCube && selectedCube.cubeType === 'data-3d' && (
            <div className="flex-1 p-4 overflow-auto">
              <h4 className="font-medium text-sm mb-3">Edit 3D Cube</h4>
              
              {/* Number of Faces */}
              <div className="space-y-2 mb-4">
                <Label className="text-xs">Number of Faces</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => updateNumFaces(Math.max(1, numFaces - 1))}
                    disabled={numFaces <= 1}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map(n => (
                      <div
                        key={n}
                        className={`w-2 h-1 rounded-full ${n <= numFaces ? 'bg-primary' : 'bg-muted'}`}
                      />
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => updateNumFaces(Math.min(4, numFaces + 1))}
                    disabled={numFaces >= 4}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {numFaces === 1 ? 'Static' : `${numFaces} faces`}
                  </span>
                </div>
              </div>

              {/* Face Tabs */}
              <Tabs value={String(activeFace)} onValueChange={(v) => setActiveFace(Number(v))}>
                <TabsList className="grid w-full mb-3" style={{ gridTemplateColumns: `repeat(${numFaces}, 1fr)` }}>
                  {Array.from({ length: numFaces }).map((_, idx) => (
                    <TabsTrigger key={idx} value={String(idx)} className="text-xs">
                      Face {idx + 1}
                      {faceMetrics[idx].length > 0 && (
                        <span className="ml-1 text-[10px] opacity-70">({faceMetrics[idx].length})</span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
                
                {Array.from({ length: numFaces }).map((_, idx) => (
                  <TabsContent key={idx} value={String(idx)} className="space-y-3">
                    {/* Face Title */}
                    <div>
                      <Label className="text-xs">Title</Label>
                      <Input
                        placeholder={`e.g., ${idx === 0 ? 'Daily' : idx === 1 ? 'Weekly' : 'Monthly'}`}
                        value={faceTitles[idx]}
                        onChange={(e) => updateFaceTitle(idx, e.target.value)}
                        className="h-8 text-sm mt-1"
                      />
                    </div>
                    
                    {/* Metrics */}
                    <div>
                      <div className="flex justify-between mb-2">
                        <Label className="text-xs">Metrics</Label>
                        <span className="text-xs text-muted-foreground">{faceMetrics[idx].length}/4</span>
                      </div>
                      <ScrollArea className="h-48">
                        {METRIC_GROUPS.map(group => (
                          <div key={group.label} className="mb-2">
                            <p className="text-[10px] text-muted-foreground mb-1">{group.label}</p>
                            <div className="flex flex-wrap gap-1">
                              {group.metrics.map(metric => {
                                const isSelected = faceMetrics[idx].includes(metric);
                                const usedElsewhere = isMetricUsedElsewhere(metric);
                                const conf = METRIC_CONFIGS[metric];
                                return (
                                  <Badge
                                    key={metric}
                                    variant={isSelected ? "default" : "outline"}
                                    className={`cursor-pointer text-[10px] ${
                                      isSelected ? 'bg-primary' : usedElsewhere ? 'opacity-40' : 'hover:bg-accent'
                                    }`}
                                    onClick={() => toggleMetric(metric)}
                                  >
                                    {isSelected && <Check className="h-2 w-2 mr-0.5" />}
                                    {conf.shortLabel}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </ScrollArea>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>

              {/* Accent Color */}
              <div className="mt-4">
                <Label className="text-xs">Accent Color</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {THEME_COLORS.map(color => (
                    <button
                      key={color.key}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${getThemeColorClass(color.key)} ${
                        selectedCube.accentColor === color.key 
                          ? 'border-foreground scale-110 ring-2 ring-offset-1 ring-primary' 
                          : 'border-transparent hover:scale-105'
                      }`}
                      onClick={() => updateSelectedCube({ accentColor: color.key })}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {selectedCube && selectedCube.cubeType === 'sales-chart' && (
            <div className="flex-1 p-4">
              <h4 className="font-medium text-sm mb-3">Sales Overview</h4>
              <p className="text-xs text-muted-foreground">
                This widget shows the full sales chart with daily, weekly, and monthly tabs. No additional configuration needed.
              </p>
            </div>
          )}

          {!selectedCube && cubes.length > 0 && (
            <div className="flex-1 p-4 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">Select a widget to edit</p>
            </div>
          )}
        </div>

        {/* Right: Live Preview */}
        <div className="flex-1 bg-muted/30 p-6 overflow-auto">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Live Preview</span>
            <span className="text-xs text-muted-foreground">
              (How {ROLE_LABELS[role]}s will see their dashboard)
            </span>
          </div>
          
          <div className="space-y-4">
            {cubes.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-muted-foreground">
                  Dashboard is empty. Add widgets on the left to configure what {ROLE_LABELS[role]}s see.
                </p>
              </Card>
            ) : (
              cubes.map((cube, index) => {
                if (cube.cubeType === 'sales-chart') {
                  return (
                    <Card key={cube.id} className="overflow-hidden">
                      <Collapsible defaultOpen>
                        <CollapsibleTrigger asChild>
                          <button 
                            className="w-full px-3 py-2 flex items-center justify-between cursor-pointer hover:opacity-90"
                            style={{ backgroundColor: '#0D9488' }}
                          >
                            <span className="text-sm font-semibold text-white">Sales Overview</span>
                            <ChevronDown className="h-4 w-4 text-white/80" />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="p-4 text-center text-muted-foreground text-sm">
                            Sales chart preview (actual data in production)
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </Card>
                  );
                }
                
                if (cube.cubeType === 'data-3d' && cube.faceMetrics && cube.numFaces) {
                  const faces = cube.faceMetrics.slice(0, cube.numFaces).map((metrics, idx) => ({
                    metrics,
                    title: cube.faceTitles?.[idx] || undefined,
                  }));
                  
                  // Skip empty cubes in preview
                  if (faces.every(f => f.metrics.length === 0)) {
                    return (
                      <Card key={cube.id} className="p-4 text-center">
                        <p className="text-muted-foreground text-sm">
                          3D Cube (no metrics selected yet)
                        </p>
                      </Card>
                    );
                  }
                  
                  return (
                    <div key={cube.id} className="aspect-square md:aspect-[2/1] max-w-lg">
                      <DataCube3D
                        title={cube.title}
                        faces={faces}
                        accentColor={cube.accentColor}
                        salesData={previewSalesData}
                        isLoading={false}
                      />
                    </div>
                  );
                }
                
                return null;
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
