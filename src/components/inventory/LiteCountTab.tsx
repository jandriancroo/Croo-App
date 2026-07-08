import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, ClipboardList, Loader2, CalendarDays } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DateTime } from "luxon";
import NewLiteCountDialog from "@/components/inventory/NewLiteCountDialog";

interface Props {
  locationId: string;
  timezone: string;
}

interface Count {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
  is_backfill?: boolean | null;
}

/**
 * Lite Count tab — list of counts + "New Count" button that opens a
 * period picker dialog (this week / historical) instead of immediately
 * creating one.
 */
export default function LiteCountTab({ locationId, timezone }: Props) {
  const navigate = useNavigate();
  const [showPicker, setShowPicker] = useState(false);

  const { data: counts, isLoading } = useQuery({
    queryKey: ["lite-counts", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<Count[]> => {
      const { data, error } = await supabase
        .from("lite_inventory_counts" as any)
        .select("id, period_start, period_end, status, submitted_at, created_at, is_backfill")
        .eq("location_id", locationId)
        .order("period_end", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const fmt = (d: string) => DateTime.fromFormat(d, "yyyy-MM-dd").toFormat("LLL d");

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Counts</h3>
          </div>
          <Button size="sm" className="gap-2" onClick={() => setShowPicker(true)}>
            <Plus className="h-4 w-4" />
            New Count
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (counts?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
            <ClipboardList className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground max-w-sm">
              No counts yet. Tap "New Count" to start this week's inventory count.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {counts!.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/inventory/${locationId}/count/${c.id}`)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 text-left"
              >
                <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    Week of {fmt(c.period_start)} – {fmt(c.period_end)}
                    {c.is_backfill && (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        Historical
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.status === "submitted" && c.submitted_at
                      ? `Submitted ${DateTime.fromISO(c.submitted_at).toRelative()}`
                      : "In progress"}
                  </div>
                </div>
                <Badge variant={c.status === "submitted" ? "default" : "secondary"} className="text-[10px]">
                  {c.status === "submitted" ? "Submitted" : "Draft"}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </Card>

      <NewLiteCountDialog
        open={showPicker}
        onOpenChange={setShowPicker}
        locationId={locationId}
        timezone={timezone}
      />
    </>
  );
}
