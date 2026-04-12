import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, AlertTriangle, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface WasteLogFormProps {
  onSave: (data: WasteLogData) => Promise<void>;
  isSaving: boolean;
}

export interface WasteLogData {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  reason: string;
  photoFile: File;
  estimatedCost: number | null;
}

type CountMode = "unit" | "case" | "pan";

interface InventoryItemRow {
  id: string;
  name: string;
  unit: string | null;
  count_unit: string | null;
  count_units_per_case: number | null;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
  cost_per_unit: number | null;
  blended_price: number | null;
  brand_item_id: string | null;
}

export function WasteLogForm({ onSave, isSaving }: WasteLogFormProps) {
  const { currentLocation } = useAppLocation();
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [countMode, setCountMode] = useState<CountMode>("unit");
  const [reason, setReason] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch active inventory items with costing fields
  const { data: items } = useQuery({
    queryKey: ["inventory-items-waste", currentLocation?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, unit, count_unit, count_units_per_case, pack_quantity, pack_quantity_override, cost_per_unit, blended_price, brand_item_id")
        .eq("location_id", currentLocation!.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as InventoryItemRow[];
    },
    enabled: !!currentLocation?.id,
  });

  // Fetch pan data from brand templates for selected item
  const selectedItem = items?.find((i) => i.id === selectedItemId);

  const { data: panData } = useQuery({
    queryKey: ["brand-template-pans", selectedItem?.brand_item_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_inventory_templates")
        .select("pan_units_per_unit, pan_units_per_lb, pan_enabled_keys, pan_overrides")
        .eq("id", selectedItem!.brand_item_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!selectedItem?.brand_item_id,
  });

  const hasPanData = panData && (panData.pan_units_per_unit || panData.pan_units_per_lb);

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  // Resolve cost per case
  const caseCost = useMemo(() => {
    if (!selectedItem) return 0;
    return selectedItem.blended_price ?? selectedItem.cost_per_unit ?? 0;
  }, [selectedItem]);

  const unitsPerCase = useMemo(() => {
    if (!selectedItem) return 1;
    return selectedItem.pack_quantity_override || selectedItem.count_units_per_case || selectedItem.pack_quantity || 1;
  }, [selectedItem]);

  const costPerUnit = caseCost / unitsPerCase;

  // Get display unit label
  const unitLabel = selectedItem?.count_unit || selectedItem?.unit || "units";

  // Calculate estimated cost based on count mode
  const estimatedCost = useMemo(() => {
    if (!selectedItem || !quantity || !caseCost) return null;
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) return null;

    switch (countMode) {
      case "case":
        return qty * caseCost;
      case "pan":
        // Pan units → convert to individual units via pan_units_per_unit
        if (panData?.pan_units_per_unit) {
          return qty * panData.pan_units_per_unit * costPerUnit;
        }
        return qty * costPerUnit; // fallback: treat as units
      case "unit":
      default:
        return qty * costPerUnit;
    }
  }, [selectedItem, quantity, countMode, caseCost, costPerUnit, panData]);

  const canSubmit = selectedItemId && quantity && reason && photoFile && !isSaving;

  const handleSubmit = () => {
    if (!canSubmit || !selectedItem || !photoFile) return;

    // Normalize quantity to units for storage
    const qty = Number(quantity);
    let normalizedQty = qty;
    let displayUnit = unitLabel;

    if (countMode === "case") {
      normalizedQty = qty * unitsPerCase;
      displayUnit = `cases (${qty} × ${unitsPerCase} ${unitLabel})`;
    } else if (countMode === "pan" && panData?.pan_units_per_unit) {
      normalizedQty = qty * panData.pan_units_per_unit;
      displayUnit = `pans (${qty} × ${panData.pan_units_per_unit} ${unitLabel})`;
    }

    onSave({
      itemId: selectedItemId,
      itemName: selectedItem.name,
      quantity: normalizedQty,
      unit: displayUnit,
      reason,
      photoFile,
      estimatedCost,
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Log Waste</h2>

      {/* Searchable item selector */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">Item</label>
        <Popover open={itemPickerOpen} onOpenChange={setItemPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={itemPickerOpen}
              className="w-full justify-between font-normal"
            >
              {selectedItem
                ? `${selectedItem.name} (${unitLabel})`
                : "Search items..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search items..." />
              <CommandList className="max-h-60">
                <CommandEmpty>No items found.</CommandEmpty>
                <CommandGroup>
                  {items?.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.name}
                      onSelect={() => {
                        setSelectedItemId(item.id);
                        setItemPickerOpen(false);
                        setCountMode("unit");
                        setQuantity("");
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedItemId === item.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {item.name} ({item.count_unit || item.unit || "ea"})
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Count mode selector — only show when item is selected */}
      {selectedItem && (
        <div>
          <label className="text-sm font-medium mb-1.5 block">Count by</label>
          <Tabs value={countMode} onValueChange={(v) => { setCountMode(v as CountMode); setQuantity(""); }}>
            <TabsList className="w-full">
              <TabsTrigger value="unit" className="flex-1">
                {unitLabel}
              </TabsTrigger>
              <TabsTrigger value="case" className="flex-1">
                Case
              </TabsTrigger>
              {hasPanData && (
                <TabsTrigger value="pan" className="flex-1">
                  Pan
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          {countMode === "case" && (
            <p className="text-xs text-muted-foreground mt-1">
              1 case = {unitsPerCase} {unitLabel}
            </p>
          )}
          {countMode === "pan" && panData?.pan_units_per_unit && (
            <p className="text-xs text-muted-foreground mt-1">
              1 pan = {panData.pan_units_per_unit} {unitLabel}
            </p>
          )}
        </div>
      )}

      {/* Quantity */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">
          Quantity{" "}
          <span className="text-muted-foreground font-normal">
            ({countMode === "case" ? "cases" : countMode === "pan" ? "pans" : unitLabel})
          </span>
        </label>
        <Input
          type="number"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0"
          min="0"
          step="any"
        />
      </div>

      {/* Reason */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">
          Why did this happen? <span className="text-destructive">*</span>
        </label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Dropped pan, expired product, equipment failure..."
          rows={3}
        />
      </div>

      {/* Photo */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">
          Photo of waste <span className="text-destructive">*</span>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoCapture}
        />
        {photoPreview ? (
          <div className="relative">
            <img
              src={photoPreview}
              alt="Waste preview"
              className="w-full h-48 rounded-lg object-cover"
            />
            <Button
              variant="secondary"
              size="sm"
              className="absolute bottom-2 right-2"
              onClick={() => fileInputRef.current?.click()}
            >
              Retake
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full h-32 flex-col gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera className="h-6 w-6" />
            <span className="text-sm">Take Photo</span>
          </Button>
        )}
      </div>

      {/* Estimated cost preview */}
      {estimatedCost != null && estimatedCost > 0 && (
        <div className="bg-destructive/10 rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium">
            Estimated loss: ${estimatedCost.toFixed(2)}
          </span>
        </div>
      )}

      <Button
        className="w-full"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {isSaving ? "Submitting..." : "Submit Waste Log"}
      </Button>
    </div>
  );
}
