import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface LiteEditableItem {
  id: string;
  name: string;
  category: string | null;
  pack_size: string | null;
  storage_id: string | null;
  is_active: boolean;
  unit: string | null;
  cost_per_unit: number | null;
  vendor_name_normalized: string | null;
  item_number: string | null;
}

interface Storage {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: LiteEditableItem | null;
  locationId: string;
  storages: Storage[];
  categorySuggestions: string[];
}

const UNASSIGNED = "__unassigned__";

export default function LiteItemEditSheet({
  open,
  onOpenChange,
  item,
  locationId,
  storages,
  categorySuggestions,
}: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [packSize, setPackSize] = useState("");
  const [storageId, setStorageId] = useState<string>(UNASSIGNED);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setName(item.name ?? "");
    setCategory(item.category ?? "");
    setPackSize(item.pack_size ?? "");
    setStorageId(item.storage_id ?? UNASSIGNED);
    setIsActive(item.is_active);
  }, [item]);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0;

  const dirty = useMemo(() => {
    if (!item) return false;
    return (
      trimmedName !== (item.name ?? "").trim() ||
      (category.trim() || null) !== (item.category ?? null) ||
      (packSize.trim() || null) !== (item.pack_size ?? null) ||
      (storageId === UNASSIGNED ? null : storageId) !== item.storage_id ||
      isActive !== item.is_active
    );
  }, [item, trimmedName, category, packSize, storageId, isActive]);

  const canSave = nameValid && dirty && !saving;

  const handleSave = async () => {
    if (!item || !canSave) return;
    setSaving(true);
    const payload = {
      name: trimmedName,
      category: category.trim() || null,
      pack_size: packSize.trim() || null,
      storage_id: storageId === UNASSIGNED ? null : storageId,
      is_active: isActive,
    };
    const { error } = await supabase
      .from("lite_inventory_items" as any)
      .update(payload)
      .eq("id", item.id);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save item", { description: error.message });
      return;
    }
    qc.invalidateQueries({ queryKey: ["lite-inventory-items", locationId] });
    toast.success("Item updated");
    onOpenChange(false);
  };

  const listId = `lite-cat-suggestions-${item?.id ?? "new"}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Edit item</SheetTitle>
          <SheetDescription className="text-xs">
            {item?.vendor_name_normalized || "Unknown vendor"}
            {item?.item_number ? ` • #${item.item_number}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="lite-item-name" className="text-xs">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="lite-item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="Item name"
            />
            {!nameValid && (
              <p className="text-[11px] text-destructive">Name is required.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lite-item-category" className="text-xs">
              Category
            </Label>
            <Input
              id="lite-item-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={80}
              placeholder="e.g. Produce, Dairy"
              list={listId}
            />
            <datalist id={listId}>
              {categorySuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lite-item-pack" className="text-xs">
              Pack size
            </Label>
            <Input
              id="lite-item-pack"
              value={packSize}
              onChange={(e) => setPackSize(e.target.value)}
              maxLength={60}
              placeholder='e.g. 6/32 oz'
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Storage</Label>
            <Select value={storageId} onValueChange={setStorageId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {storages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <div>
              <Label htmlFor="lite-item-active" className="text-sm">
                Active
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Archived items are hidden from counts.
              </p>
            </div>
            <Switch
              id="lite-item-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          {item?.cost_per_unit != null && (
            <div className="text-[11px] text-muted-foreground">
              Cost ${Number(item.cost_per_unit).toFixed(2)} per {item.unit || "unit"} — pulled from invoices, not editable here.
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-2 justify-end sticky bottom-0 bg-background pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
