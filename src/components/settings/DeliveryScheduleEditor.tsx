import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Save, Loader2, Truck } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Monday-start: 0=Mon, 1=Tue, ..., 6=Sun
const DAYS = [
  { value: '0', label: 'Monday' },
  { value: '1', label: 'Tuesday' },
  { value: '2', label: 'Wednesday' },
  { value: '3', label: 'Thursday' },
  { value: '4', label: 'Friday' },
  { value: '5', label: 'Saturday' },
  { value: '6', label: 'Sunday' },
];

export interface DeliverySlot {
  order_day: number;
  delivery_day: number;
}

interface DeliveryScheduleEditorProps {
  integrationId: string | undefined;
  existingCredentials: any;
  schedule: DeliverySlot[];
  onScheduleChange: (schedule: DeliverySlot[]) => void;
  onSaved?: () => void;
}

export function DeliveryScheduleEditor({
  integrationId,
  existingCredentials,
  schedule,
  onScheduleChange,
  onSaved,
}: DeliveryScheduleEditorProps) {
  const [isSaving, setIsSaving] = useState(false);

  const addSlot = () => {
    onScheduleChange([...schedule, { order_day: 0, delivery_day: 1 }]);
  };

  const removeSlot = (index: number) => {
    onScheduleChange(schedule.filter((_, i) => i !== index));
  };

  const updateSlot = (index: number, field: 'order_day' | 'delivery_day', value: number) => {
    const updated = [...schedule];
    updated[index] = { ...updated[index], [field]: value };
    onScheduleChange(updated);
  };

  const save = async () => {
    if (!integrationId) return;
    setIsSaving(true);
    try {
      const updatedCreds = { ...existingCredentials, delivery_schedule: schedule };
      const { error } = await supabase
        .from('location_integrations')
        .update({ credentials: updatedCreds })
        .eq('id', integrationId);
      if (error) throw error;
      toast.success('Delivery schedule saved!');
      onSaved?.();
    } catch (e) {
      toast.error('Failed to save schedule');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Collapsible>
      <div className="border-t pt-3">
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
          <Truck className="h-3.5 w-3.5" />
          <span>Delivery Schedule</span>
          {schedule.length > 0 && (
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full ml-auto">
              {schedule.length} slot{schedule.length !== 1 ? 's' : ''}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          {schedule.length === 0 && (
            <p className="text-xs text-muted-foreground">No delivery days configured yet.</p>
          )}
          {schedule.map((slot, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Order Day</Label>
                <Select value={String(slot.order_day)} onValueChange={(v) => updateSlot(i, 'order_day', Number(v))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <span className="text-xs text-muted-foreground pb-2">→</span>
              <div className="flex-1 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Delivers</Label>
                <Select value={String(slot.delivery_day)} onValueChange={(v) => updateSlot(i, 'delivery_day', Number(v))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeSlot(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addSlot}>
              <Plus className="h-3 w-3 mr-1" /> Add Slot
            </Button>
            {schedule.length > 0 && (
              <Button size="sm" className="h-7 text-xs" onClick={save} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                Save Schedule
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
