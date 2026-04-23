import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, Square, RectangleHorizontal, LineChart, Box, Trophy, Upload, X, Crop, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { 
  WidgetSize, 
  MetricType, 
  METRIC_CONFIGS, 
  METRIC_GROUPS,
} from "./DashboardWidget";
import { THEME_COLORS, ThemeColorKey, getThemeColorClass } from "@/utils/themeColors";
import { TrackerPosItemPicker } from "./TrackerPosItemPicker";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { supabase } from "@/integrations/supabase/client";

export type TrackerScopeType = 'user' | 'role' | 'location';
export type TrackerDisplayMode = 'summary' | 'expandable';
export type TrackerRankMetric = 'units' | 'sales' | 'pmix';
export type CubeType = 'data' | 'sales-chart' | 'tracker';

export interface NewDataCubeConfig {
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  cubeType: CubeType;
  trackerScope?: { type: TrackerScopeType; role?: string };
  trackerDisplayMode?: TrackerDisplayMode;
  trackerItemRefs?: string[];
  trackerPromoStart?: string | null;
  trackerPromoEnd?: string | null;
  trackerPromoImageUrl?: string | null;
  trackerLocationRefs?: string[];
  trackerRankMetrics?: TrackerRankMetric[];
}

interface AddWidgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (config: NewDataCubeConfig) => void;
  defaultColorIndex?: number;
  hasSalesChart?: boolean; // If true, hide the sales chart option
  onAdd3DCube?: () => void; // Callback to open 3D cube dialog
}

type Step = 'type' | 'size' | 'configure';

export function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
  defaultColorIndex = 0,
  hasSalesChart = false,
  onAdd3DCube,
}: AddWidgetDialogProps) {
  const promoImageInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('type');
  const [selectedType, setSelectedType] = useState<CubeType>('data');
  const [selectedSize, setSelectedSize] = useState<WidgetSize>('small');
  const [promoImageToCrop, setPromoImageToCrop] = useState('');
  const [promoCropDialogOpen, setPromoCropDialogOpen] = useState(false);
  const [isPromoImageUploading, setIsPromoImageUploading] = useState(false);
  const [config, setConfig] = useState<NewDataCubeConfig>({
    title: '',
    size: 'small',
    metrics: [],
    accentColor: THEME_COLORS[defaultColorIndex % THEME_COLORS.length].key,
    cubeType: 'data',
    trackerScope: { type: 'location' },
    trackerDisplayMode: 'expandable',
    trackerItemRefs: [],
    trackerPromoStart: null,
    trackerPromoEnd: null,
    trackerPromoImageUrl: null,
    trackerLocationRefs: [],
    trackerRankMetrics: ['units', 'sales', 'pmix'],
  });

  const resetDialog = () => {
    setStep('type');
    setSelectedType('data');
    setSelectedSize('small');
    setConfig({
      title: '',
      size: 'small',
      metrics: [],
      accentColor: THEME_COLORS[defaultColorIndex % THEME_COLORS.length].key,
      cubeType: 'data',
        trackerScope: { type: 'location' },
        trackerDisplayMode: 'expandable',
        trackerItemRefs: [],
        trackerPromoStart: null,
        trackerPromoEnd: null,
        trackerPromoImageUrl: null,
        trackerLocationRefs: [],
        trackerRankMetrics: ['units', 'sales', 'pmix'],
    });
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      resetDialog();
    }
    onOpenChange(isOpen);
  };

  const handleTypeSelect = (type: CubeType) => {
    setSelectedType(type);
    setConfig(prev => ({ ...prev, cubeType: type }));
    
    if (type === 'tracker') {
      setConfig(prev => ({
        ...prev,
        cubeType: 'tracker',
        size: 'large',
        title: '',
        metrics: [],
        trackerScope: { type: 'location' },
        trackerDisplayMode: 'expandable',
        trackerRankMetrics: ['units', 'sales', 'pmix'],
      }));
      setStep('configure');
    } else if (type === 'sales-chart') {
      // Sales chart is always large and skips size/configure steps
      setConfig(prev => ({ 
        ...prev, 
        cubeType: type,
        size: 'large',
        title: 'Sales Overview',
        metrics: [],
      }));
      onAdd({
        title: 'Sales Overview',
        size: 'large',
        metrics: [],
        accentColor: THEME_COLORS[defaultColorIndex % THEME_COLORS.length].key,
        cubeType: 'sales-chart',
      });
      handleClose(false);
    } else {
      setStep('size');
    }
  };

  const handleSizeSelect = (size: WidgetSize) => {
    setSelectedSize(size);
    setConfig(prev => ({ ...prev, size }));
    setStep('configure');
  };

  const toggleMetric = (metric: MetricType) => {
    const maxMetrics = selectedSize === 'small' ? 3 : selectedSize === 'medium' ? 4 : 6;
    const currentMetrics = config.metrics;
    
    if (currentMetrics.includes(metric)) {
      setConfig(prev => ({ ...prev, metrics: currentMetrics.filter(m => m !== metric) }));
    } else if (currentMetrics.length < maxMetrics) {
      setConfig(prev => ({ ...prev, metrics: [...currentMetrics, metric] }));
    }
  };

  const handleAddDataCube = () => {
    if (config.cubeType !== 'tracker' && config.metrics.length === 0) return;
    onAdd(config);
    handleClose(false);
  };

  const handlePromoImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    setPromoImageToCrop(previewUrl);
    setPromoCropDialogOpen(true);
    event.target.value = '';
  };

  const handlePromoImageCropComplete = async (croppedBlob: Blob) => {
    setIsPromoImageUploading(true);
    try {
      const filePath = `promo-trackers/promo-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('brand-assets')
        .upload(filePath, croppedBlob, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('brand-assets')
        .getPublicUrl(filePath);

      setConfig(prev => ({ ...prev, trackerPromoImageUrl: data.publicUrl }));
      toast.success('Promo image uploaded');
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload promo image');
    } finally {
      setIsPromoImageUploading(false);
      if (promoImageToCrop.startsWith('blob:')) URL.revokeObjectURL(promoImageToCrop);
      setPromoImageToCrop('');
    }
  };

  const maxMetrics = selectedSize === 'small' ? 3 : selectedSize === 'medium' ? 4 : 6;

  const handleBack = () => {
    if (step === 'configure') {
      setStep(selectedType === 'tracker' ? 'type' : 'size');
    } else if (step === 'size') {
      setStep('type');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md flex-col overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)]">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2">
            {step !== 'type' && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 w-8 p-0"
                onClick={handleBack}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {step === 'type' && 'Add Widget'}
            {step === 'size' && 'Choose Size'}
            {step === 'configure' && (selectedType === 'tracker' ? 'Configure Tracker' : 'Configure Data Cube')}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Type Selection */}
        {step === 'type' && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              What would you like to add?
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Data Cube (3D) */}
              {onAdd3DCube && (
                <button
                  className="flex flex-col items-center gap-3 p-4 rounded-xl border-2 border-primary/30 hover:border-primary hover:bg-accent transition-all bg-primary/5"
                  onClick={() => {
                    handleClose(false);
                    onAdd3DCube();
                  }}
                >
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/50 flex items-center justify-center">
                    <Box className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-center">
                    <span className="text-sm font-medium block">Data Cube</span>
                    <span className="text-[10px] text-muted-foreground">1-4 rotating faces</span>
                  </div>
                </button>
              )}

              {/* Sales Chart */}
              <button
                className={`flex flex-col items-center gap-3 p-4 rounded-xl border-2 border-transparent transition-all ${
                  hasSalesChart 
                    ? 'opacity-40 cursor-not-allowed' 
                    : 'hover:border-primary/50 hover:bg-accent'
                }`}
                onClick={() => !hasSalesChart && handleTypeSelect('sales-chart')}
                disabled={hasSalesChart}
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/40 flex items-center justify-center">
                  <LineChart className="h-6 w-6 text-blue-500" />
                </div>
                <div className="text-center">
                  <span className="text-sm font-medium block">Sales Chart</span>
                  <span className="text-[10px] text-muted-foreground">
                    {hasSalesChart ? 'Already added' : 'Visual overview'}
                  </span>
                </div>
              </button>

              {/* Tracker */}
              <button
                className="flex flex-col items-center gap-3 p-4 rounded-xl border-2 border-transparent hover:border-primary/50 hover:bg-accent transition-all"
                onClick={() => handleTypeSelect('tracker')}
              >
                <div className="w-14 h-14 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Trophy className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center">
                  <span className="text-sm font-medium block">Tracker</span>
                  <span className="text-[10px] text-muted-foreground">Promo ranking</span>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Size Selection (Small or Medium only for Data Cubes) */}
        {step === 'size' && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              Select a size
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Small */}
              <button
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-transparent hover:border-primary/50 hover:bg-accent transition-all"
                onClick={() => handleSizeSelect('small')}
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center">
                  <Square className="h-6 w-6 text-primary" />
                </div>
                <span className="text-sm font-medium">Small</span>
                <span className="text-[10px] text-muted-foreground">1-3 metrics</span>
              </button>

              {/* Medium */}
              <button
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-transparent hover:border-primary/50 hover:bg-accent transition-all"
                onClick={() => handleSizeSelect('medium')}
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center">
                  <RectangleHorizontal className="h-6 w-6 text-primary" />
                </div>
                <span className="text-sm font-medium">Medium</span>
                <span className="text-[10px] text-muted-foreground">Wide, 4 metrics</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Configure Data Cube */}
        {step === 'configure' && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">{selectedType === 'tracker' ? 'Promo Name' : 'Title'}</Label>
              <Input
                id="title"
                placeholder={selectedType === 'tracker' ? 'e.g., Sweet Heat' : "e.g., Today's Sales"}
                value={config.title}
                onChange={(e) => setConfig(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>

            {selectedType === 'tracker' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="promo-start">Promo Start</Label>
                    <Input id="promo-start" type="date" className="h-9" value={config.trackerPromoStart || ''} onChange={(e) => setConfig(prev => ({ ...prev, trackerPromoStart: e.target.value || null }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="promo-end">Promo End</Label>
                    <Input id="promo-end" type="date" className="h-9" value={config.trackerPromoEnd || ''} onChange={(e) => setConfig(prev => ({ ...prev, trackerPromoEnd: e.target.value || null }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Promo Image</Label>
                  <input ref={promoImageInputRef} type="file" accept="image/*" className="hidden" onChange={handlePromoImageSelect} disabled={isPromoImageUploading} />
                  {config.trackerPromoImageUrl ? (
                    <div className="space-y-2">
                      <div className="relative h-[58px] overflow-hidden rounded-lg border bg-primary">
                        <img src={config.trackerPromoImageUrl} alt="Promo preview" className="absolute inset-0 h-full w-full object-cover" />
                        <div className="absolute inset-0 bg-background/30" />
                        <div className="absolute inset-0 bg-gradient-to-r from-background/35 via-background/10 to-background/35" />
                        <div className="absolute left-3 top-2 inline-flex max-w-[68%] flex-col rounded-md border border-background/20 bg-foreground/50 px-2.5 py-1.5 text-background shadow-md shadow-foreground/15 backdrop-blur-md">
                          <p className="text-[10px] font-bold uppercase leading-none tracking-wider text-background/70">Live promo</p>
                          <p className="mt-1 max-w-full truncate text-sm font-semibold leading-tight">{config.title || 'Promo'}</p>
                        </div>
                        <Button type="button" variant="destructive" size="icon" className="absolute right-2 top-2 h-7 w-7" onClick={() => setConfig(prev => ({ ...prev, trackerPromoImageUrl: null }))}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => promoImageInputRef.current?.click()} disabled={isPromoImageUploading}>
                          <Upload className="mr-2 h-4 w-4" />
                          Replace
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => { setPromoImageToCrop(config.trackerPromoImageUrl || ''); setPromoCropDialogOpen(true); }} disabled={isPromoImageUploading}>
                          <Crop className="mr-2 h-4 w-4" />
                          Crop
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="flex h-24 w-full items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-muted-foreground transition-colors hover:border-muted-foreground/50" onClick={() => promoImageInputRef.current?.click()} disabled={isPromoImageUploading}>
                      {isPromoImageUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                    </button>
                  )}
                </div>
                <TrackerPosItemPicker
                  value={config.trackerItemRefs || []}
                  onChange={(items) => setConfig(prev => ({ ...prev, trackerItemRefs: items }))}
                />
                <div className="space-y-1.5">
                  <Label>Scope</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['user', 'role', 'location'] as TrackerScopeType[]).map(scope => (
                      <Button key={scope} type="button" variant={config.trackerScope?.type === scope ? 'default' : 'outline'} size="sm" onClick={() => setConfig(prev => ({ ...prev, trackerScope: { type: scope } }))}>
                        {scope === 'user' ? 'User' : scope === 'role' ? 'Role' : 'Location'}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Dashboard View</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant={config.trackerDisplayMode === 'summary' ? 'default' : 'outline'} size="sm" onClick={() => setConfig(prev => ({ ...prev, trackerDisplayMode: 'summary' }))}>My Rank</Button>
                    <Button type="button" variant={config.trackerDisplayMode === 'expandable' ? 'default' : 'outline'} size="sm" onClick={() => setConfig(prev => ({ ...prev, trackerDisplayMode: 'expandable' }))}>Expandable</Button>
                  </div>
                </div>
              </div>
            )}

            {/* Metrics Selection */}
            {selectedType !== 'tracker' && <div className="space-y-2">
              <Label>
                Metrics 
                <span className="text-muted-foreground font-normal ml-1">
                  ({config.metrics.length}/{maxMetrics})
                </span>
              </Label>
              
              {METRIC_GROUPS.map(group => (
                <div key={group.label} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{group.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {group.metrics.map(metric => {
                      const isSelected = config.metrics.includes(metric);
                      const conf = METRIC_CONFIGS[metric];
                      return (
                        <Badge
                          key={metric}
                          variant={isSelected ? "default" : "outline"}
                          className={`cursor-pointer text-xs ${
                            isSelected 
                              ? 'bg-primary' 
                              : 'hover:bg-accent'
                          }`}
                          onClick={() => toggleMetric(metric)}
                        >
                          {isSelected && <Check className="h-3 w-3 mr-1" />}
                          {conf.shortLabel}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>}

            {/* Color Selection */}
            <div className="space-y-2">
              <Label>Accent Color</Label>
              <div className="flex flex-wrap gap-2">
                {THEME_COLORS.map(color => (
                  <button
                    key={color.key}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${getThemeColorClass(color.key)} ${
                      config.accentColor === color.key 
                        ? 'border-foreground scale-110 ring-2 ring-offset-2 ring-primary' 
                        : 'border-transparent hover:scale-105'
                    }`}
                    onClick={() => setConfig(prev => ({ ...prev, accentColor: color.key }))}
                    title={color.label}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'configure' && (
          <DialogFooter className="shrink-0 border-t bg-background px-4 py-3">
            <Button
              onClick={handleAddDataCube}
              disabled={(selectedType !== 'tracker' && config.metrics.length === 0) || isPromoImageUploading}
            >
              {selectedType === 'tracker' ? 'Add Tracker' : 'Add Data Cube'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
      <ImageCropDialog
        open={promoCropDialogOpen}
        onOpenChange={setPromoCropDialogOpen}
        imageSrc={promoImageToCrop}
        onCropComplete={handlePromoImageCropComplete}
        cropShape="rect"
        aspect={1 / 0.58}
        cropAreaClassName="!h-[232px]"
      />
    </Dialog>
  );
}