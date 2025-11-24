import { useDraggable } from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ShiftCardProps {
  shift: any;
  isDragging?: boolean;
  onDelete?: () => void;
}

export function ShiftCard({ shift, isDragging, onDelete }: ShiftCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: shift.isTemplate ? `template-${shift.template.id}` : `shift-${shift.id}`,
    data: shift,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes}${ampm}`;
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shift.id) return;

    if (!confirm("Delete this shift?")) return;

    try {
      const { error } = await supabase.from("scheduled_shifts").delete().eq("id", shift.id);

      if (error) throw error;
      toast.success("Shift deleted");
      onDelete?.();
    } catch (error) {
      console.error("Error deleting shift:", error);
      toast.error("Failed to delete shift");
    }
  };

  const shiftData = shift.isTemplate ? shift.template : shift;
  const bgColor = shiftData.color || "#ef4444";

  return (
    <Card
      ref={setNodeRef}
      style={{ ...style, backgroundColor: bgColor }}
      className={`p-2 cursor-grab active:cursor-grabbing relative group ${isDragging ? "opacity-50" : ""}`}
      {...listeners}
      {...attributes}
    >
      <div className="text-white text-xs font-medium">
        {shift.isTemplate ? shiftData.template_name : `${formatTime(shiftData.start_time)} - ${formatTime(shiftData.end_time)}`}
      </div>
      {shift.is_time_off && <div className="text-white text-xs">TIME OFF</div>}
      {!shift.isTemplate && onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0 h-6 w-6 opacity-0 group-hover:opacity-100 text-white hover:bg-white/20"
          onClick={handleDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </Card>
  );
}
