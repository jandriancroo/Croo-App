import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Check, FilePlus2, Link2 } from "lucide-react";
import { format } from "date-fns";

export interface TrailStep {
  id: string;
  family_id: string | null;
  reason: string;
  is_final_warning: boolean;
  created_at: string;
}

interface Props {
  employeeId: string | null;
  /** null = new issue (trail starts at this row) */
  selectedFamilyId: string | null;
  onSelect: (familyId: string | null) => void;
  currentReason: string;
}

export function CorrectiveActionTrails({ employeeId, selectedFamilyId, onSelect, currentReason }: Props) {
  const { data: steps = [], isLoading } = useQuery({
    queryKey: ["corrective-action-trails", employeeId],
    queryFn: async (): Promise<TrailStep[]> => {
      if (!employeeId) return [];
      const { data, error } = await supabase
        .from("employee_writeups")
        .select("id, family_id, reason, is_final_warning, created_at")
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as TrailStep[];
    },
    enabled: !!employeeId,
    staleTime: 60 * 1000,
  });

  if (!employeeId) return null;

  // Latest step per trail
  const latestByFamily = new Map<string, TrailStep>();
  const countByFamily = new Map<string, number>();
  for (const s of steps) {
    const fam = s.family_id || s.id;
    countByFamily.set(fam, (countByFamily.get(fam) || 0) + 1);
    if (!latestByFamily.has(fam)) latestByFamily.set(fam, s);
  }
  const trails = Array.from(latestByFamily.entries());

  const selectedTrail = selectedFamilyId ? latestByFamily.get(selectedFamilyId) : null;
  const reasonMismatch =
    !!selectedTrail && !!currentReason && selectedTrail.reason !== currentReason;

  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        History for this employee
      </Label>

      {isLoading && <p className="text-xs text-muted-foreground">Checking history…</p>}

      {!isLoading && trails.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No prior corrective actions. This starts a new issue.
        </p>
      )}

      {trails.length > 0 && (
        <div className="space-y-2">
          {trails.map(([familyId, latest]) => {
            const active = selectedFamilyId === familyId;
            return (
              <button
                key={familyId}
                type="button"
                onClick={() => onSelect(active ? null : familyId)}
                className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                  active ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{latest.reason}</Badge>
                    {latest.is_final_warning && (
                      <Badge variant="outline" className="text-[10px] border-destructive text-destructive">
                        Final warning
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(latest.created_at), "MMM d, yyyy")}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {countByFamily.get(familyId)} step{(countByFamily.get(familyId) || 0) > 1 ? "s" : ""}
                    </span>
                  </div>
                  {active ? (
                    <Check className="h-4 w-4 text-primary shrink-0" />
                  ) : (
                    <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </div>
              </button>
            );
          })}

          <Button
            type="button"
            variant={selectedFamilyId ? "outline" : "secondary"}
            size="sm"
            className="w-full"
            onClick={() => onSelect(null)}
          >
            <FilePlus2 className="h-4 w-4 mr-1" />
            {selectedFamilyId ? "Start a new issue instead" : "New issue (not attached)"}
          </Button>
        </div>
      )}

      {reasonMismatch && (
        <p className="text-xs text-amber-600 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Heads up: this trail's last step was "{selectedTrail!.reason}" but you picked "{currentReason}".
          Both are kept as-is — nothing is overwritten.
        </p>
      )}
    </div>
  );
}
