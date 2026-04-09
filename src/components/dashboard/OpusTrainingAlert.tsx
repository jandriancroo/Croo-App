import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { GraduationCap, ExternalLink, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export function OpusTrainingAlert() {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const [open, setOpen] = useState(false);

  const { data: modules = [] } = useQuery({
    queryKey: ["opus-training", currentLocation?.id, user?.id],
    queryFn: async () => {
      if (!currentLocation?.id || !user?.id) return [];
      const { data, error } = await supabase
        .from("opus_training_modules")
        .select("*")
        .eq("location_id", currentLocation.id)
        .eq("user_id", user.id)
        .lt("completion_pct", 100)
        .order("completion_pct", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation?.id && !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  if (modules.length === 0) return null;

  return (
    <>
      {/* Compact alert pill on dashboard */}
      <button
        onClick={() => setOpen(true)}
        className="dashboard-task-pill w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-purple-200/60 dark:border-purple-500/30 transition-all active:scale-[0.98]"
        style={{ backgroundColor: "hsl(263 70% 96% / 0.9)" }}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/15">
          <GraduationCap className="h-4.5 w-4.5 text-purple-600 dark:text-purple-400" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <span className="text-sm font-semibold text-purple-900 dark:text-purple-100">
            {modules.length} Training Module{modules.length !== 1 ? "s" : ""} Incomplete
          </span>
          <p className="text-[11px] text-purple-600/70 dark:text-purple-300/60 truncate">
            Tap to view & complete on OPUS
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-purple-400 shrink-0" />
      </button>

      {/* Detail dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-purple-600" />
              OPUS Training
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {modules.map((mod) => (
              <div
                key={mod.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-muted/30"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{mod.module_name}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Progress value={mod.completion_pct} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground font-mono w-8 text-right">
                      {mod.completion_pct}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button
            size="lg"
            className="w-full mt-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-lg h-14 rounded-xl"
            onClick={() => {
              window.open("https://dashboard.opus.so", "_blank");
              setOpen(false);
            }}
          >
            <ExternalLink className="h-5 w-5 mr-2" />
            GO — Complete on OPUS
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
