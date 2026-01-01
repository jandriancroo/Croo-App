import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, Square, RectangleHorizontal, LayoutGrid, LineChart } from "lucide-react";
import { 
  WidgetSize, 
  MetricType, 
  METRIC_CONFIGS, 
  METRIC_GROUPS,
} from "./DashboardWidget";

const ACCENT_COLORS = [
  // Classic post-it colors
  { value: "#F59E0B", label: "Yellow" },
  { value: "#EC4899", label: "Pink" },
  { value: "#22C55E", label: "Green" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#8B5CF6", label: "Purple" },
  { value: "#14B8A6", label: "Teal" },
  { value: "#EF4444", label: "Red" },
  { value: "#F97316", label: "Orange" },
  // Theme-inspired colors
  { value: "#0891B2", label: "Croo Teal" },
  { value: "#EA580C", label: "Croo Orange" },
  { value: "#0F766E", label: "Ocean" },
  { value: "#166534", label: "Sage" },
  { value: "#7C3AED", label: "Lavender" },
  { value: "#6366F1", label: "Indigo" },
  { value: "#84CC16", label: "Lime" },
  { value: "#06B6D4", label: "Cyan" },
];

export type CubeType = 'data' | 'sales-chart';

export interface NewDataCubeConfig {
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  cubeType: CubeType;
}

interface AddWidgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (config: NewDataCubeConfig) => void;
  defaultColorIndex?: number;
  hasSalesChart?: boolean; // If true, hide the sales chart option
}

type Step = 'type' | 'size' | 'configure';

export function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
  defaultColorIndex = 0,
  hasSalesChart = false,
}: AddWidgetDialogProps) {
  const [step, setStep] = useState<Step>('type');
  const [selectedType, setSelectedType] = useState<CubeType>('data');
  const [selectedSize, setSelectedSize] = useState<WidgetSize>('small');
  const [config, setConfig] = useState<NewDataCubeConfig>({
    title: '',
    size: 'small',
    metrics: [],
    accentColor: ACCENT_COLORS[defaultColorIndex % ACCENT_COLORS.length].value,
    cubeType: 'data',
  });

  const resetDialog = () => {
    setStep('type');
    setSelectedType('data');
    setSelectedSize('small');
    setConfig({
      title: '',
      size: 'small',
      metrics: [],
      accentColor: ACCENT_COLORS[defaultColorIndex % ACCENT_COLORS.length].value,
      cubeType: 'data',
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
    
    if (type === 'sales-chart') {
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
        accentColor: ACCENT_COLORS[defaultColorIndex % ACCENT_COLORS.length].value,
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
    if (config.metrics.length === 0) return;
    onAdd(config);
    handleClose(false);
  };

  const maxMetrics = selectedSize === 'small' ? 3 : selectedSize === 'medium' ? 4 : 6;

  const handleBack = () => {
    if (step === 'configure') {
      setStep('size');
    } else if (step === 'size') {
      setStep('type');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
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
            {step === 'configure' && 'Configure Data Cube'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Type Selection */}
        {step === 'type' && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              What would you like to add?
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Data Cube */}
              <button
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-transparent hover:border-primary/50 hover:bg-accent transition-all"
                onClick={() => handleTypeSelect('data')}
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center">
                  <LayoutGrid className="h-6 w-6 text-primary" />
                </div>
                <span className="text-sm font-medium">Data Cube</span>
                <span className="text-[10px] text-muted-foreground">Custom metrics</span>
              </button>

              {/* Sales Chart - greyed out if already added */}
              <button
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-transparent transition-all ${
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
                <span className="text-sm font-medium">Sales Chart</span>
                <span className="text-[10px] text-muted-foreground">
                  {hasSalesChart ? 'Already added' : 'Full sales overview'}
                </span>
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
          <div className="space-y-4 py-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="e.g., Today's Sales"
                value={config.title}
                onChange={(e) => setConfig(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>

            {/* Metrics Selection */}
            <div className="space-y-2">
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
            </div>

            {/* Color Selection */}
            <div className="space-y-2">
              <Label>Accent Color</Label>
              <div className="flex flex-wrap gap-2">
                {ACCENT_COLORS.map(color => (
                  <button
                    key={color.value}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      config.accentColor === color.value 
                        ? 'border-foreground scale-110' 
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => setConfig(prev => ({ ...prev, accentColor: color.value }))}
                    title={color.label}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'configure' && (
          <DialogFooter>
            <Button
              onClick={handleAddDataCube}
              disabled={config.metrics.length === 0}
            >
              Add Data Cube
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}