import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Check, Archive, Save, Loader2 } from "lucide-react";

type ProposalRow = {
  id: string;
  brand_template_id: string;
  outer_qty: number;
  outer_type: string;
  inner_qty: number | null;
  inner_type: string | null;
  common_unit: string;
  count_units_per_case: number;
  cost_per_common_unit: number | null;
  label: string | null;
  source: string | null;
  source_evidence: any;
  status: string;
  template?: {
    id: string;
    product_name: string;
    category: string | null;
    item_number: string | null;
  } | null;
};

type Draft = {
  outer_qty: number;
  outer_type: string;
  inner_qty: number | null;
  inner_type: string | null;
  common_unit: string;
  cost_per_common_unit: number | null;
  label: string | null;
};

const sourceLabel = (s: string | null) => {
  if (!s) return "unknown";
  if (s.startsWith("vendor_sync:")) return `Sync · ${s.split(":")[1].toUpperCase()}`;
  if (s.startsWith("invoice:")) return `Invoice · ${s.split(":")[1].toUpperCase()}`;
  return s;
};

const sourceVariant = (s: string | null): "default" | "secondary" | "outline" => {
  if (s?.startsWith("invoice:")) return "secondary";
  return "outline";
};

export default function BrandPackConfigApprovals() {
  const { brandId } = useParams<{ brandId: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<Record<string, string | null>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["pack-config-proposals", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_pack_configs")
        .select(
          "id, brand_template_id, outer_qty, outer_type, inner_qty, inner_type, common_unit, count_units_per_case, cost_per_common_unit, label, source, source_evidence, status, template:brand_inventory_templates!inner(id, brand_id, product_name, category, item_number)"
        )
        .eq("status", "proposed")
        .eq("brand_inventory_templates.brand_id", brandId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ProposalRow[];
    },
    enabled: !!brandId,
  });

  const grouped = useMemo(() => {
    const m = new Map<string, { template: ProposalRow["template"]; rows: ProposalRow[] }>();
    (data ?? []).forEach((r) => {
      const k = r.brand_template_id;
      if (!m.has(k)) m.set(k, { template: r.template, rows: [] });
      m.get(k)!.rows.push(r);
    });
    return Array.from(m.values()).sort((a, b) =>
      (a.template?.product_name || "").localeCompare(b.template?.product_name || "")
    );
  }, [data]);

  const getDraft = (r: ProposalRow): Draft =>
    drafts[r.id] ?? {
      outer_qty: r.outer_qty,
      outer_type: r.outer_type,
      inner_qty: r.inner_qty,
      inner_type: r.inner_type,
      common_unit: r.common_unit,
      cost_per_common_unit: r.cost_per_common_unit,
      label: r.label,
    };

  const patchDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...getDraft({ id, ...d[id] } as any), ...patch } as Draft }));

  const setRowBusy = (id: string, label: string | null) =>
    setBusy((b) => ({ ...b, [id]: label }));

  // ---- Save Draft ----
  const saveDraft = useMutation({
    mutationFn: async (r: ProposalRow) => {
      const d = getDraft(r);
      const outer = Number(d.outer_qty) || 0;
      const inner = d.inner_qty == null || d.inner_qty === ("" as any) ? null : Number(d.inner_qty);
      const count_units_per_case = outer * (inner ?? 1);
      if (!outer || !d.outer_type || !d.common_unit) {
        throw new Error("outer_qty, outer_type, and common_unit are required");
      }
      const { error } = await supabase
        .from("brand_pack_configs")
        .update({
          outer_qty: outer,
          outer_type: d.outer_type,
          inner_qty: inner,
          inner_type: d.inner_type || null,
          common_unit: d.common_unit,
          count_units_per_case,
          cost_per_common_unit: d.cost_per_common_unit == null ? null : Number(d.cost_per_common_unit),
          label: d.label || null,
        })
        .eq("id", r.id)
        .eq("status", "proposed");
      if (error) throw error;
    },
    onSuccess: (_, r) => {
      toast({ title: "Draft saved", description: r.template?.product_name ?? "" });
      qc.invalidateQueries({ queryKey: ["pack-config-proposals", brandId] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // ---- Approve ----
  const approve = useMutation({
    mutationFn: async (r: ProposalRow) => {
      const d = getDraft(r);
      const outer = Number(d.outer_qty) || 0;
      const inner = d.inner_qty == null || d.inner_qty === ("" as any) ? null : Number(d.inner_qty);
      const count_units_per_case = outer * (inner ?? 1);
      if (!outer || !d.outer_type || !d.common_unit) {
        throw new Error("outer_qty, outer_type, and common_unit are required");
      }

      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id ?? null;

      // (1) finalize the config row
      const { error: updErr } = await supabase
        .from("brand_pack_configs")
        .update({
          outer_qty: outer,
          outer_type: d.outer_type,
          inner_qty: inner,
          inner_type: d.inner_type || null,
          common_unit: d.common_unit,
          count_units_per_case,
          cost_per_common_unit: d.cost_per_common_unit == null ? null : Number(d.cost_per_common_unit),
          label: d.label || null,
          status: "approved",
          approved_by: uid,
          approved_at: new Date().toISOString(),
        })
        .eq("id", r.id)
        .eq("status", "proposed");
      if (updErr) throw updErr;

      // (2) find locations actively using this brand template
      const { data: items, error: itemsErr } = await supabase
        .from("inventory_items")
        .select("location_id")
        .eq("brand_item_id", r.brand_template_id)
        .eq("is_active", true);
      if (itemsErr) throw itemsErr;
      const locIds = Array.from(new Set((items ?? []).map((i: any) => i.location_id).filter(Boolean)));

      // (3) for each location, check if a default already exists for this (location, template)
      let inserted = 0;
      let defaulted = 0;
      for (const location_id of locIds) {
        const { data: existing } = await supabase
          .from("location_pack_selections")
          .select("active_pack_config_id, is_default")
          .eq("location_id", location_id)
          .eq("brand_template_id", r.brand_template_id);
        const hasDefault = (existing ?? []).some((e: any) => e.is_default);
        const alreadyHere = (existing ?? []).some((e: any) => e.active_pack_config_id === r.id);
        if (alreadyHere) continue;
        const is_default = !hasDefault;
        const { error: insErr } = await supabase.from("location_pack_selections").insert({
          location_id,
          brand_template_id: r.brand_template_id,
          active_pack_config_id: r.id,
          is_default,
          selected_by: uid,
        });
        if (insErr) throw insErr;
        inserted += 1;
        if (is_default) defaulted += 1;
      }
      return { inserted, defaulted, locCount: locIds.length };
    },
    onSuccess: (res, r) => {
      toast({
        title: "Approved",
        description: `${r.template?.product_name}: ${res.inserted} location selection(s) written, ${res.defaulted} marked default.`,
      });
      qc.invalidateQueries({ queryKey: ["pack-config-proposals", brandId] });
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  // ---- Reject ----
  const reject = useMutation({
    mutationFn: async (r: ProposalRow) => {
      const { error } = await supabase
        .from("brand_pack_configs")
        .update({ status: "archived" })
        .eq("id", r.id)
        .eq("status", "proposed");
      if (error) throw error;
    },
    onSuccess: (_, r) => {
      toast({ title: "Rejected", description: r.template?.product_name ?? "" });
      qc.invalidateQueries({ queryKey: ["pack-config-proposals", brandId] });
    },
    onError: (e: any) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/brand/${brandId}/inventory`}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Pack Config Approvals</h1>
        <Badge variant="outline" className="ml-2">
          {data?.length ?? 0} proposals
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        Approving writes to <code>brand_pack_configs</code> and <code>location_pack_selections</code> only.
        Counts, items, and templates are not touched.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading proposals...
        </div>
      )}

      {!isLoading && grouped.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">No pending proposals.</CardContent>
        </Card>
      )}

      {grouped.map(({ template, rows }) => (
        <Card key={template?.id ?? "x"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <span>{template?.product_name ?? "(unknown template)"}</span>
              {template?.category && (
                <Badge variant="outline" className="text-xs">{template.category}</Badge>
              )}
              {template?.item_number && (
                <span className="text-xs text-muted-foreground font-mono">#{template.item_number}</span>
              )}
              {rows.length > 1 && (
                <Badge variant="secondary" className="text-xs">{rows.length} proposals</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((r) => {
              const d = getDraft(r);
              const ev = r.source_evidence || {};
              const isBusy = !!busy[r.id];
              return (
                <div key={r.id} className="rounded-lg border p-3 space-y-3 bg-muted/30">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={sourceVariant(r.source)}>{sourceLabel(r.source)}</Badge>
                    {ev.vendor && <span className="text-xs text-muted-foreground">vendor: <b>{ev.vendor}</b></span>}
                    {ev.territory && <span className="text-xs text-muted-foreground">territory: {ev.territory}</span>}
                    {ev.sku && <span className="text-xs font-mono text-muted-foreground">SKU {ev.sku}</span>}
                    {ev.packString && <span className="text-xs text-muted-foreground">pack: <code>{ev.packString}</code></span>}
                    {ev.costPerCase != null && (
                      <span className="text-xs text-muted-foreground">case ${Number(ev.costPerCase).toFixed(2)}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <Field label="Outer qty">
                      <Input type="number" value={d.outer_qty ?? ""} onChange={(e) => patchDraft(r.id, { outer_qty: Number(e.target.value) })} />
                    </Field>
                    <Field label="Outer type">
                      <Input value={d.outer_type ?? ""} onChange={(e) => patchDraft(r.id, { outer_type: e.target.value })} />
                    </Field>
                    <Field label="Inner qty">
                      <Input type="number" value={d.inner_qty ?? ""} onChange={(e) => patchDraft(r.id, { inner_qty: e.target.value === "" ? null : Number(e.target.value) })} />
                    </Field>
                    <Field label="Inner type">
                      <Input value={d.inner_type ?? ""} onChange={(e) => patchDraft(r.id, { inner_type: e.target.value })} />
                    </Field>
                    <Field label="Common unit">
                      <Input value={d.common_unit ?? ""} onChange={(e) => patchDraft(r.id, { common_unit: e.target.value })} />
                    </Field>
                    <Field label="$ / common unit">
                      <Input type="number" step="0.0001" value={d.cost_per_common_unit ?? ""} onChange={(e) => patchDraft(r.id, { cost_per_common_unit: e.target.value === "" ? null : Number(e.target.value) })} />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label="Label (optional)">
                      <Input value={d.label ?? ""} onChange={(e) => patchDraft(r.id, { label: e.target.value })} placeholder="e.g. case, sack, 4-pack" />
                    </Field>
                    <div className="flex items-end text-xs text-muted-foreground">
                      count_units_per_case = {(Number(d.outer_qty) || 0) * ((d.inner_qty ?? 1) || 1)}
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={async () => {
                        setRowBusy(r.id, "save");
                        try { await saveDraft.mutateAsync(r); } finally { setRowBusy(r.id, null); }
                      }}
                    >
                      <Save className="h-4 w-4" /> Save Draft
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isBusy}
                      onClick={async () => {
                        if (!confirm("Reject this proposal? It will be archived.")) return;
                        setRowBusy(r.id, "reject");
                        try { await reject.mutateAsync(r); } finally { setRowBusy(r.id, null); }
                      }}
                    >
                      <Archive className="h-4 w-4" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={isBusy}
                      onClick={async () => {
                        setRowBusy(r.id, "approve");
                        try { await approve.mutateAsync(r); } finally { setRowBusy(r.id, null); }
                      }}
                    >
                      {busy[r.id] === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs space-y-1 block">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
