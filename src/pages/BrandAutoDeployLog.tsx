import { useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, CheckCircle2, RotateCcw } from "lucide-react";
import { format } from "date-fns";

interface LogRow {
  id: string;
  location_id: string;
  brand_template_id: string;
  inventory_item_id: string | null;
  recipe_ids: string[];
  action: string;
  triggered_by: string;
  deployed_at: string;
}

const BrandAutoDeployLog = () => {
  const { brandId } = useParams<{ brandId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const locationFilter = params.get("location");

  const { data: log, isLoading } = useQuery({
    queryKey: ["auto-deploy-log", brandId, locationFilter],
    queryFn: async () => {
      // Scope to locations within the brand's organizations
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, locations(id, name)")
        .eq("brand_id", brandId!);
      const locIds = (orgs ?? []).flatMap((o: any) => (o.locations ?? []).map((l: any) => l.id));
      const locNames = new Map<string, string>();
      for (const o of orgs ?? []) for (const l of (o as any).locations ?? []) locNames.set(l.id, l.name);

      let q = supabase
        .from("brand_auto_deployment_log")
        .select("*")
        .in("location_id", locIds.length ? locIds : ["00000000-0000-0000-0000-000000000000"])
        .order("deployed_at", { ascending: false })
        .limit(500);
      if (locationFilter) q = q.eq("location_id", locationFilter);

      const { data, error } = await q;
      if (error) throw error;

      const tplIds = Array.from(new Set((data ?? []).map((r: any) => r.brand_template_id)));
      const { data: tpls } = tplIds.length
        ? await supabase
            .from("brand_inventory_templates")
            .select("id, product_name")
            .in("id", tplIds)
        : { data: [] };
      const tplNames = new Map<string, string>();
      for (const t of tpls ?? []) tplNames.set((t as any).id, (t as any).product_name);

      return (data ?? []).map((r: any) => ({
        ...r,
        _templateName: tplNames.get(r.brand_template_id) ?? "—",
        _locationName: locNames.get(r.location_id) ?? "—",
      })) as (LogRow & { _templateName: string; _locationName: string })[];
    },
    enabled: !!brandId,
  });

  const totals = useMemo(() => {
    const created = (log ?? []).filter(r => r.action === "created").length;
    const reactivated = (log ?? []).filter(r => r.action === "reactivated").length;
    return { created, reactivated, total: (log ?? []).length };
  }, [log]);

  return (
    <div className="container max-w-6xl py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Auto-Deployment Log</h1>
          <p className="text-sm text-muted-foreground">
            Items the nightly sweep deployed automatically because a recipe referenced them but they weren't in local inventory.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total events</div><div className="text-2xl font-semibold">{totals.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Created</div><div className="text-2xl font-semibold text-emerald-600">{totals.created}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Reactivated</div><div className="text-2xl font-semibold text-blue-600">{totals.reactivated}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent activity {locationFilter ? "(filtered to one location)" : ""}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : !log || log.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No auto-deployments yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Recipes referencing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.deployed_at), "MMM d, h:mm a")}</TableCell>
                    <TableCell className="text-sm">{r._locationName}</TableCell>
                    <TableCell className="text-sm font-medium">{r._templateName}</TableCell>
                    <TableCell>
                      {r.action === "created" ? (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Created
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-blue-500/40 text-blue-700 dark:text-blue-400 gap-1">
                          <RotateCcw className="h-3 w-3" /> Reactivated
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{r.recipe_ids?.length ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BrandAutoDeployLog;
