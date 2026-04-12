import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Camera, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

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

export function WasteLogForm({ onSave, isSaving }: WasteLogFormProps) {
  const { currentLocation } = useAppLocation();
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch active inventory items for this location
  const { data: items } = useQuery({
    queryKey: ["inventory-items-active", currentLocation?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, unit, cost_per_unit")
        .eq("location_id", currentLocation!.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation?.id,
  });

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const selectedItem = items?.find((i) => i.id === selectedItemId);
  const estimatedCost =
    selectedItem?.cost_per_unit && quantity
      ? Number(quantity) * Number(selectedItem.cost_per_unit)
      : null;

  const canSubmit = selectedItemId && quantity && reason && photoFile && !isSaving;

  const handleSubmit = () => {
    if (!canSubmit || !selectedItem || !photoFile) return;
    onSave({
      itemId: selectedItemId,
      itemName: selectedItem.name,
      quantity: Number(quantity),
      unit: selectedItem.unit || "units",
      reason,
      photoFile,
      estimatedCost,
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Log Waste</h2>

      {/* Item selector */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">Item</label>
        <Select value={selectedItemId} onValueChange={setSelectedItemId}>
          <SelectTrigger>
            <SelectValue placeholder="Select item..." />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {items?.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name} ({item.unit})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Quantity */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">
          Quantity{" "}
          {selectedItem && (
            <span className="text-muted-foreground font-normal">
              ({selectedItem.unit})
            </span>
          )}
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
