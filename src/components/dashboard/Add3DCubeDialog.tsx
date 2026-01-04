import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Plus, Minus, Box } from "lucide-react";
import { 
  MetricType, 
  METRIC_CONFIGS, 
  METRIC_GROUPS,
} from "./DashboardWidget";
import { THEME_COLORS, ThemeColorKey, getThemeColorClass } from "@/utils/themeColors";

export interface New3DCubeConfig {
  title: string;
  faceMetrics: MetricType[][]; // Array of faces, each face has up to 4 metrics
  numFaces: number;
  accentColor: string;
}

interface Add3DCubeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (config: New3DCubeConfig) => void;
  defaultColorIndex?: number;
}

export function Add3DCubeDialog({
  open,
  onOpenChange,
  onAdd,
  defaultColorIndex = 0,
}: Add3DCubeDialogProps) {
  const [numFaces, setNumFaces] = useState(2);
  const [activeFace, setActiveFace] = useState(0);
  const [title, setTitle] = useState('');
  const [accentColor, setAccentColor] = useState<ThemeColorKey>(THEME_COLORS[defaultColorIndex % THEME_COLORS.length].key);
  const [faceMetrics, setFaceMetrics] = useState<MetricType[][]>([[], [], [], []]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetDialog = () => {
    setNumFaces(2);
    setActiveFace(0);
    setTitle('');
    setAccentColor(THEME_COLORS[defaultColorIndex % THEME_COLORS.length].key);
    setFaceMetrics([[], [], [], []]);
    setIsSubmitting(false);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      resetDialog();
    }
    onOpenChange(isOpen);
  };

  const toggleMetric = (metric: MetricType) => {
    const currentFaceMetrics = faceMetrics[activeFace];
    const maxMetrics = 4;
    
    if (currentFaceMetrics.includes(metric)) {
      // Remove metric
      const updated = [...faceMetrics];
      updated[activeFace] = currentFaceMetrics.filter(m => m !== metric);
      setFaceMetrics(updated);
    } else if (currentFaceMetrics.length < maxMetrics) {
      // Add metric
      const updated = [...faceMetrics];
      updated[activeFace] = [...currentFaceMetrics, metric];
      setFaceMetrics(updated);
    }
  };

  const handleAddCube = async () => {
    if (isSubmitting) return;
    
    // Get only the faces we're using
    const usedFaces = faceMetrics.slice(0, numFaces);
    
    // Check that at least one face has metrics
    const hasAnyMetrics = usedFaces.some(face => face.length > 0);
    if (!hasAnyMetrics) return;

    setIsSubmitting(true);
    
    try {
      await onAdd({
        title,
        faceMetrics: usedFaces,
        numFaces,
        accentColor,
      });
      handleClose(false);
    } catch (error) {
      console.error('Error adding cube:', error);
      setIsSubmitting(false);
    }
  };

  const currentFaceMetrics = faceMetrics[activeFace];
  const usedFaces = faceMetrics.slice(0, numFaces);
  const totalMetrics = usedFaces.reduce((sum, face) => sum + face.length, 0);
  const hasAnyMetrics = totalMetrics > 0;

  // Check if a metric is used on another face
  const isMetricUsedElsewhere = (metric: MetricType) => {
    return faceMetrics.some((face, idx) => idx !== activeFace && idx < numFaces && face.includes(metric));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Box className="h-5 w-5" />
            Add 3D Data Cube
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="e.g., Performance Overview"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Number of Faces */}
          <div className="space-y-2">
            <Label>Number of Faces</Label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setNumFaces(Math.max(1, numFaces - 1))}
                disabled={numFaces <= 1}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map(n => (
                  <div
                    key={n}
                    className={`w-3 h-1 rounded-full transition-all ${
                      n <= numFaces ? 'bg-primary' : 'bg-muted'
                    }`}
                    style={{ transform: 'rotate(-15deg)' }}
                  />
                ))}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setNumFaces(Math.min(4, numFaces + 1))}
                disabled={numFaces >= 4}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground ml-2">
                {numFaces === 1 ? 'No rotation' : `${numFaces} faces`}
              </span>
            </div>
          </div>

          {/* Face Tabs */}
          <div className="space-y-2">
            <Label>Configure Faces</Label>
            <Tabs value={String(activeFace)} onValueChange={(v) => setActiveFace(Number(v))}>
              <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${numFaces}, 1fr)` }}>
                {Array.from({ length: numFaces }).map((_, idx) => (
                  <TabsTrigger key={idx} value={String(idx)} className="text-xs">
                    Face {idx + 1}
                    {faceMetrics[idx].length > 0 && (
                      <span className="ml-1 text-[10px] opacity-70">
                        ({faceMetrics[idx].length})
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              
              {Array.from({ length: numFaces }).map((_, idx) => (
                <TabsContent key={idx} value={String(idx)} className="mt-3">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Select up to 4 metrics for this face
                      </span>
                      <span className="text-xs font-medium">
                        {faceMetrics[idx].length}/4
                      </span>
                    </div>
                    
                    {METRIC_GROUPS.map(group => (
                      <div key={group.label} className="space-y-1">
                        <p className="text-xs text-muted-foreground">{group.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {group.metrics.map(metric => {
                            const isSelected = faceMetrics[idx].includes(metric);
                            const usedElsewhere = isMetricUsedElsewhere(metric);
                            const conf = METRIC_CONFIGS[metric];
                            return (
                              <Badge
                                key={metric}
                                variant={isSelected ? "default" : "outline"}
                                className={`cursor-pointer text-xs transition-all ${
                                  isSelected 
                                    ? 'bg-primary' 
                                    : usedElsewhere
                                      ? 'opacity-40'
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
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* Color Selection */}
          <div className="space-y-2">
            <Label>Accent Color</Label>
            <div className="flex flex-wrap gap-2">
              {THEME_COLORS.map(color => (
                <button
                  key={color.key}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${getThemeColorClass(color.key)} ${
                    accentColor === color.key 
                      ? 'border-foreground scale-110 ring-2 ring-offset-2 ring-primary' 
                      : 'border-transparent hover:scale-105'
                  }`}
                  onClick={() => setAccentColor(color.key)}
                  title={color.label}
                />
              ))}
            </div>
          </div>

          {/* Preview indicator */}
          <div className="flex items-center justify-center gap-2 py-2">
            <div 
              className={`w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg ${getThemeColorClass(accentColor)}`}
            >
              {totalMetrics}
            </div>
            <div className="text-sm text-muted-foreground">
              <div>Total metrics across {numFaces} face{numFaces > 1 ? 's' : ''}</div>
              <div className="text-xs">
                {numFaces > 1 ? 'Rotates every 10 seconds' : 'Static display'}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleAddCube}
            disabled={!hasAnyMetrics || isSubmitting}
          >
            {isSubmitting ? 'Adding...' : 'Add 3D Cube'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
