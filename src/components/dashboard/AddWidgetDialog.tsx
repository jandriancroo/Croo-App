import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, Square, RectangleHorizontal, LayoutGrid } from "lucide-react";
import { 
  WidgetSize, 
  MetricType, 
  METRIC_CONFIGS, 
  METRIC_GROUPS,
} from "./DashboardWidget";

const ACCENT_COLORS = [
  { value: "#8B5CF6", label: "Purple" },
  { value: "#10B981", label: "Green" },
  { value: "#F59E0B", label: "Orange" },
  { value: "#EF4444", label: "Red" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#EC4899", label: "Pink" },
  { value: "#14B8A6", label: "Teal" },
  { value: "#6366F1", label: "Indigo" },
];

export interface NewDataCubeConfig {
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
}

interface AddWidgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (config: NewDataCubeConfig) => void;
  defaultColorIndex?: number;
}

type Step = 'size' | 'configure';

export function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
  defaultColorIndex = 0,
}: AddWidgetDialogProps) {
  const [step, setStep] = useState<Step>('size');
  const [selectedSize, setSelectedSize] = useState<WidgetSize>('small');
  const [config, setConfig] = useState<NewDataCubeConfig>({
    title: '',
    size: 'small',
    metrics: [],
    accentColor: ACCENT_COLORS[defaultColorIndex % ACCENT_COLORS.length].value,
  });

  const resetDialog = () => {
    setStep('size');
    setSelectedSize('small');
    setConfig({
      title: '',
      size: 'small',
      metrics: [],
      accentColor: ACCENT_COLORS[defaultColorIndex % ACCENT_COLORS.length].value,
    });
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      resetDialog();
    }
    onOpenChange(isOpen);
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step !== 'size' && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 w-8 p-0"
                onClick={() => setStep('size')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {step === 'size' && 'Choose Size'}
            {step === 'configure' && 'Configure Data Cube'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Size Selection */}
        {step === 'size' && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              Select a size
            </p>
            
            <div className="grid grid-cols-3 gap-4">
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
                <span className="text-[10px] text-muted-foreground">Wide card</span>
              </button>

              {/* Large */}
              <button
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-transparent hover:border-primary/50 hover:bg-accent transition-all"
                onClick={() => handleSizeSelect('large')}
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center">
                  <LayoutGrid className="h-6 w-6 text-primary" />
                </div>
                <span className="text-sm font-medium">Large</span>
                <span className="text-[10px] text-muted-foreground">With chart</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Configure Data Cube */}
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