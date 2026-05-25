import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Check, Archive, Save, Loader2, X, Search } from "lucide-react";
import { TO_OZ } from "@/utils/unitConversion";
import { CountLanesPreview } from "@/components/inventory/CountLanesPreview";
import { computeCountLanes } from "@/utils/computeCountLanes";

const CANONICAL_UNITS = Object.keys(TO_OZ).sort();
const PACKAGING_NOUNS = ["sleeve", "bag", "box", "pack", "ea"];
const OUTER_TYPE_PRESETS = ["case", "sleeve", "bag", "box", "pack", "ea"];
const NONE_SENTINEL = "__none__";
const OTHER_SENTINEL = "__other__";

function UnitSelect({
  value,
  onChange,
  allowNone = false,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
}) {
  const v = value ?? "";
  return (
    <Select
      value={v === "" && allowNone ? NONE_SENTINEL : v}
      onValueChange={(next) => onChange(next === NONE_SENTINEL ? null : next)}
    >
      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE_SENTINEL}>— none (single tier) —</SelectItem>}
        {CANONICAL_UNITS.map((u) => (
          <SelectItem key={u} value={u}>{u}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OuterTypeSelect({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
}) {
  const v = value ?? "";
  const isPreset = OUTER_TYPE_PRESETS.includes(v);
  const [otherMode, setOtherMode] = useState(!!v && !isPreset);
  if (otherMode) {
    return (
      <div className="flex gap-1">
        <Input
          value={v}
          autoFocus
          placeholder="custom…"
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-8 shrink-0"
          onClick={() => { setOtherMode(false); onChange(""); }}
          title="Back to presets"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }
  return (
    <Select
      value={v || undefined}
      onValueChange={(next) => {
        if (next === OTHER_SENTINEL) { setOtherMode(true); onChange(""); return; }
        onChange(next);
      }}
    >
      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
      <SelectContent>
        {OUTER_TYPE_PRESETS.map((t) => (
          <SelectItem key={t} value={t}>{t}</SelectItem>
        ))}
        <SelectItem value={OTHER_SENTINEL}>Add other…</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * Hybrid inner_type picker. Inner tier can be EITHER a packaging noun
 * (sleeve, bag, box, pack, ea — describes the actual inner container) OR a
 * converter unit (oz, lb, kg, ml… — used when the inner tier IS the measure,
 * e.g. "case of 12 × 1 lb"). Includes a "— none —" option for two-tier items
 * and an "Add other…" escape hatch for unusual nouns.
 *
 * The chosen string drives the count-screen middle-lane label (via
 * computeCountLanes' resolveInnerLabel: e.g. "sleeve" → "Sleeves").
 */
function InnerTypeSelect({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
}) {
  const v = value ?? "";
  const isKnown =
    v === "" || PACKAGING_NOUNS.includes(v) || CANONICAL_UNITS.includes(v);
  const [otherMode, setOtherMode] = useState(!!v && !isKnown);
  if (otherMode) {
    return (
      <div className="flex gap-1">
        <Input
          value={v}
          autoFocus
          placeholder="custom inner…"
          onChange={(e) => onChange(e.target.value || null)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-8 shrink-0"
          onClick={() => { setOtherMode(false); onChange(null); }}
          title="Back to presets"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }
  return (
    <Select
      value={v === "" ? NONE_SENTINEL : v}
      onValueChange={(next) => {
        if (next === NONE_SENTINEL) { onChange(null); return; }
        if (next === OTHER_SENTINEL) { setOtherMode(true); onChange(null); return; }
        onChange(next);
      }}
    >
      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_SENTINEL}>— none (single tier) —</SelectItem>
        <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Packaging</div>
        {PACKAGING_NOUNS.map((n) => (
          <SelectItem key={`pkg-${n}`} value={n}>{n}</SelectItem>
        ))}
        <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Units</div>
        {CANONICAL_UNITS.filter((u) => !PACKAGING_NOUNS.includes(u)).map((u) => (
          <SelectItem key={`unit-${u}`} value={u}>{u}</SelectItem>
        ))}
        <SelectItem value={OTHER_SENTINEL}>Add other…</SelectItem>
      </SelectContent>
    </Select>
  );
}
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

type ApprovalLogEntry = {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
  timestamp: string;
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
  const [approvalLog, setApprovalLog] = useState<ApprovalLogEntry[]>([]);

  const pushApprovalLog = (
    level: ApprovalLogEntry["level"],
    message: string,
    data?: unknown
  ) => {
    setApprovalLog((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        level,
        message,
        data,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["pack-config-proposals", brandId],
    queryFn: async () => {
      const { data: tpls, error: tErr } = await supabase
        .from("brand_inventory_templates")
        .select("id, brand_id, product_name, category, item_number")
        .eq("brand_id", brandId!);
      if (tErr) throw tErr;
      const tplIds = (tpls ?? []).map((t: any) => t.id);
      if (tplIds.length === 0)
        return { rows: [] as ProposalRow[], locByTpl: new Map<string, { id: string; name: string }[]>() };
      const tplMap = new Map((tpls ?? []).map((t: any) => [t.id, t]));
      const { data, error } = await supabase
        .from("brand_pack_configs")
        .select(
          "id, brand_template_id, outer_qty, outer_type, inner_qty, inner_type, common_unit, count_units_per_case, cost_per_common_unit, label, source, source_evidence, status"
        )
        .eq("status", "proposed")
        .in("brand_template_id", tplIds)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = ((data ?? []) as any[]).map((r) => ({
        ...r,
        template: tplMap.get(r.brand_template_id),
      })) as ProposalRow[];

      // Derive which locations carry each (template, vendor) pair.
      // A location qualifies when it has the item in its active catalog with a
      // vendor-specific identifier (item_number=PFG, pa_item_id=PA, else vendor_source match).
      // We do NOT gate on last_synced_at: PA never stamps it, and invoice-upload paths
      // (Heimark + manual PFG photos) populate real cost/pack data without touching it.
      // The right qualifying signal is "the location carries this item," which is exactly
      // what location_pack_selections is for.
      const proposedTplIds = Array.from(new Set(rows.map((r) => r.brand_template_id)));
      const locByTplVendor = new Map<string, { id: string; name: string }[]>();
      if (proposedTplIds.length > 0) {
        const { data: items } = await supabase
          .from("inventory_items")
          .select("brand_item_id, location_id, last_synced_at, item_number, pa_item_id, vendor_source")
          .in("brand_item_id", proposedTplIds)
          .eq("is_active", true);
        const locIds = Array.from(
          new Set((items ?? []).map((i: any) => i.location_id).filter(Boolean))
        );
        const locNameMap = new Map<string, string>();
        if (locIds.length > 0) {
          const { data: locs } = await supabase
            .from("locations")
            .select("id, name")
            .in("id", locIds);
          (locs ?? []).forEach((l: any) => locNameMap.set(l.id, l.name));
        }

        // Real-store gate: a location qualifies for a vendor's proposal ONLY when
        // it has an ACTIVE location_integrations row whose integration_type matches
        // the proposal's vendor. Stops location_pack_selections from being written
        // to dead/test stores that got a deploy stamp but never connected to the
        // vendor. Independent from locations.lens_enabled (the READ gate) —
        // selections are the permanent record, lens_enabled is the temporary
        // rollout switch.
        //
        // vendor key (short form, used in locByTplVendor key) → integration_type
        //   "pfg"   → "pfg"
        //   "pa"    → "produce_alliance"
        //   <other> → passthrough (matches integration_type as-is)
        const vendorKeyToIntegrationType = (v: string): string =>
          v === "pa" ? "produce_alliance" : v;

        const activeIntegrationLocs = new Map<string, Set<string>>(); // integration_type → set<location_id>
        if (locIds.length > 0) {
          const { data: ints } = await supabase
            .from("location_integrations")
            .select("location_id, integration_type, is_active")
            .in("location_id", locIds)
            .eq("is_active", true);
          (ints ?? []).forEach((row: any) => {
            const t = String(row.integration_type || "").toLowerCase();
            if (!t) return;
            if (!activeIntegrationLocs.has(t)) activeIntegrationLocs.set(t, new Set());
            activeIntegrationLocs.get(t)!.add(row.location_id);
          });
        }
        const locationHasVendor = (locId: string, vendorKey: string): boolean => {
          const t = vendorKeyToIntegrationType(vendorKey);
          return activeIntegrationLocs.get(t)?.has(locId) === true;
        };

        const grouped = new Map<string, Map<string, string>>();
        const addPair = (tplId: string, vendor: string, locId: string) => {
          // Vendor-gate: only add when this location actually has an active
          // integration of the proposal's vendor type.
          if (!locationHasVendor(locId, vendor)) return;
          const key = `${tplId}::${vendor}`;
          if (!grouped.has(key)) grouped.set(key, new Map());
          grouped.get(key)!.set(locId, locNameMap.get(locId) ?? "Unknown");
        };
        (items ?? []).forEach((i: any) => {
          if (!i.brand_item_id || !i.location_id) return;
          if (i.item_number) addPair(i.brand_item_id, "pfg", i.location_id);
          if (i.pa_item_id) addPair(i.brand_item_id, "pa", i.location_id);
          if (i.vendor_source) {
            const v = String(i.vendor_source).toLowerCase();
            if (v !== "pfg" && v !== "pa" && v !== "produce_alliance") {
              addPair(i.brand_item_id, v, i.location_id);
            }
          }
        });
        grouped.forEach((m, key) => {
          locByTplVendor.set(
            key,
            Array.from(m.entries())
              .map(([id, name]) => ({ id, name }))
              .sort((a, b) => a.name.localeCompare(b.name))
          );
        });
      }
      return { rows, locByTplVendor };
    },
    enabled: !!brandId,
  });

  const proposalRows = data?.rows ?? [];
  const locByTplVendor = data?.locByTplVendor ?? new Map<string, { id: string; name: string }[]>();

  const normalizeVendor = (v: string | null | undefined): string | null => {
    if (!v) return null;
    const s = String(v).toLowerCase();
    if (s === "produce_alliance") return "pa";
    return s;
  };

  const locationsForProposal = (r: ProposalRow): { id: string; name: string }[] => {
    const ev = (r.source_evidence || {}) as any;
    const vendor =
      normalizeVendor(ev.vendor) ||
      normalizeVendor(r.source?.startsWith("vendor_sync:") ? r.source.split(":")[1] : null) ||
      normalizeVendor(r.source?.startsWith("invoice:") ? r.source.split(":")[1] : null);
    if (!vendor) return [];
    return locByTplVendor.get(`${r.brand_template_id}::${vendor}`) ?? [];
  };

  // ---- Filters + bulk select state ----
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [competingOnly, setCompetingOnly] = useState<boolean>(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<null | "approve" | "reject">(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const proposalVendor = (r: ProposalRow): string => {
    const ev = (r.source_evidence || {}) as any;
    const v =
      (ev.vendor ? String(ev.vendor) : null) ||
      (r.source?.startsWith("vendor_sync:") ? r.source.split(":")[1] : null) ||
      (r.source?.startsWith("invoice:") ? r.source.split(":")[1] : null);
    if (!v) return "unknown";
    const s = v.toLowerCase();
    return s === "produce_alliance" ? "pa" : s;
  };

  const vendorOptions = useMemo(() => {
    const s = new Set<string>();
    proposalRows.forEach((r) => s.add(proposalVendor(r)));
    return Array.from(s).sort();
  }, [proposalRows]);

  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    proposalRows.forEach((r) => {
      if (r.template?.category) s.add(r.template.category);
    });
    return Array.from(s).sort();
  }, [proposalRows]);

  // Count proposals per template (for "competing only" filter)
  const proposalCountByTpl = useMemo(() => {
    const m = new Map<string, number>();
    proposalRows.forEach((r) => m.set(r.brand_template_id, (m.get(r.brand_template_id) ?? 0) + 1));
    return m;
  }, [proposalRows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return proposalRows.filter((r) => {
      if (vendorFilter !== "all" && proposalVendor(r) !== vendorFilter) return false;
      if (categoryFilter !== "all" && (r.template?.category ?? "") !== categoryFilter) return false;
      if (competingOnly && (proposalCountByTpl.get(r.brand_template_id) ?? 0) < 2) return false;
      if (q) {
        const ev = (r.source_evidence || {}) as any;
        const hay = [
          r.template?.product_name,
          r.template?.item_number,
          ev.sku,
          ev.packString,
          r.template?.category,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [proposalRows, vendorFilter, categoryFilter, competingOnly, query, proposalCountByTpl]);

  const grouped = useMemo(() => {
    const m = new Map<string, { template: ProposalRow["template"]; rows: ProposalRow[] }>();
    filteredRows.forEach((r) => {
      const k = r.brand_template_id;
      if (!m.has(k)) m.set(k, { template: r.template, rows: [] });
      m.get(k)!.rows.push(r);
    });
    return Array.from(m.values()).sort((a, b) =>
      (a.template?.product_name || "").localeCompare(b.template?.product_name || "")
    );
  }, [filteredRows]);

  // Trim selection to currently visible rows
  const visibleIds = useMemo(() => new Set(filteredRows.map((r) => r.id)), [filteredRows]);
  const effectiveSelected = useMemo(() => {
    const s = new Set<string>();
    selected.forEach((id) => { if (visibleIds.has(id)) s.add(id); });
    return s;
  }, [selected, visibleIds]);

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const selectAllVisible = () => setSelected(new Set(visibleIds));
  const clearSelection = () => setSelected(new Set());

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
    setDrafts((d) => {
      const row = proposalRows.find((r) => r.id === id);
      const base: Draft = d[id] ?? (row ? {
        outer_qty: row.outer_qty,
        outer_type: row.outer_type,
        inner_qty: row.inner_qty,
        inner_type: row.inner_type,
        common_unit: row.common_unit,
        cost_per_common_unit: row.cost_per_common_unit,
        label: row.label,
      } : {
        outer_qty: null, outer_type: null, inner_qty: null, inner_type: null,
        common_unit: null, cost_per_common_unit: null, label: null,
      });
      return { ...d, [id]: { ...base, ...patch } };
    });

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
      const tag = `[Approve ${r.template?.product_name ?? r.id}]`;
      setApprovalLog([]);
      const log = (level: ApprovalLogEntry["level"], message: string, data?: unknown) => {
        if (level === "error") console.error(message, data);
        else if (level === "warn") console.warn(message, data);
        else console.log(message, data);
        pushApprovalLog(level, message, data);
      };

      console.groupCollapsed(`${tag} start`);
      log("info", `${tag} start`, r);

      const d = getDraft(r);
      const outer = Number(d.outer_qty) || 0;
      const inner = d.inner_qty == null || d.inner_qty === ("" as any) ? null : Number(d.inner_qty);
      const count_units_per_case = outer * (inner ?? 1);
      log("info", `${tag} draft values`, {
        outer,
        inner,
        count_units_per_case,
        outer_type: d.outer_type,
        common_unit: d.common_unit,
        cost_per_common_unit: d.cost_per_common_unit,
        label: d.label,
      });

      if (!outer || !d.outer_type || !d.common_unit) {
        log("error", `${tag} validation failed — missing outer_qty/outer_type/common_unit`);
        console.groupEnd();
        throw new Error("outer_qty, outer_type, and common_unit are required");
      }

      // Null-cost guard (fail-closed): never approve a config that would silently
      // value at $0. Resolver also falls back to local if this somehow slips through,
      // but the approval flow blocks it up-front so it never reaches the read path.
      const lensCost = d.cost_per_common_unit == null ? null : Number(d.cost_per_common_unit);
      if (lensCost == null || !Number.isFinite(lensCost) || lensCost <= 0) {
        log("error", `${tag} validation failed — cost_per_common_unit must be > 0 (got ${d.cost_per_common_unit})`);
        console.groupEnd();
        throw new Error("cost_per_common_unit must be greater than 0 before approving. Fix the cost, save the draft, then approve.");
      }

      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id ?? null;
      log("info", `${tag} approver uid`, uid);

      // (1) finalize the config row
      log("info", `${tag} STEP 1: updating brand_pack_configs row ${r.id} → status=approved`);
      const { error: updErr, data: updData } = await supabase
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
        .eq("status", "proposed")
        .select();
      if (updErr) {
        log("error", `${tag} brand_pack_configs update FAILED`, updErr);
        console.groupEnd();
        throw updErr;
      }
      log("info", `${tag} brand_pack_configs updated`, updData);

      // (2) find locations that ACTUALLY carry this proposal's vendor SKU
      const locs = locationsForProposal(r);
      const locIds = locs.map((l) => l.id);
      log("info", `${tag} STEP 2: ${locIds.length} location(s) qualify (synced + has SKU)`, locs.map(l => l.name));

      // (2a) BEFORE snapshot — inventory_items.cost_per_unit for these locations + this SKU
      const vendorSku = (r as any).vendor_item_number ?? (r as any).item_number ?? r.template?.item_number ?? null;
      log("info", `${tag} STEP 2a: BEFORE snapshot for vendor SKU=${vendorSku}`);
      let beforeSnap: any[] = [];
      if (vendorSku && locIds.length) {
        const { data: snap, error: snapErr } = await supabase
          .from("inventory_items")
          .select("location_id, item_number, name, cost_per_unit, last_synced_at, updated_at")
          .in("location_id", locIds)
          .eq("item_number", vendorSku);
        if (snapErr) log("warn", `${tag} BEFORE snapshot query failed`, snapErr);
        beforeSnap = snap ?? [];
        const beforeTable = beforeSnap.map(row => ({
          location: locs.find(l => l.id === row.location_id)?.name ?? row.location_id,
          cost_per_unit: row.cost_per_unit,
          last_synced_at: row.last_synced_at,
          updated_at: row.updated_at,
        }));
        console.table(beforeTable);
        log("info", `${tag} BEFORE snapshot rows`, beforeTable);
      } else {
        log("warn", `${tag} skipping BEFORE snapshot (no vendor SKU or no locations)`);
      }

      // (3) for each location, check if a default already exists for this (location, template)
      let inserted = 0;
      let defaulted = 0;
      let skipped = 0;
      for (const location_id of locIds) {
        const locName = locs.find(l => l.id === location_id)?.name ?? location_id;
        const { data: existing } = await supabase
          .from("location_pack_selections")
          .select("active_pack_config_id, is_default, selected_at")
          .eq("location_id", location_id)
          .eq("brand_template_id", r.brand_template_id);
        const rows = existing ?? [];
        const alreadyHere = rows.find((e: any) => e.active_pack_config_id === r.id);

        // CASE A — exact config already present. Ensure it's the default
        // (a prior reset may have demoted it). Idempotent.
        if (alreadyHere) {
          if (!(alreadyHere as any).is_default) {
            // Demote any other default first (uniq index allows only one default per (location, template)).
            await supabase
              .from("location_pack_selections")
              .update({ is_default: false })
              .eq("location_id", location_id)
              .eq("brand_template_id", r.brand_template_id)
              .eq("is_default", true);
            const { error: upErr } = await supabase
              .from("location_pack_selections")
              .update({ is_default: true, selected_by: uid, selected_at: new Date().toISOString() })
              .eq("location_id", location_id)
              .eq("brand_template_id", r.brand_template_id)
              .eq("active_pack_config_id", r.id);
            if (upErr) {
              log("error", `${tag} ${locName}: promote-to-default failed`, upErr);
              console.groupEnd();
              throw upErr;
            }
            log("info", `${tag} ${locName}: existing row re-promoted to default`);
            defaulted += 1;
          } else {
            log("info", `${tag} ${locName}: already default — no-op`);
            skipped += 1;
          }
          continue;
        }

        // CASE B — no row exists for this (location, template). Plain INSERT as default.
        if (rows.length === 0) {
          const { error: insErr } = await supabase.from("location_pack_selections").insert({
            location_id,
            brand_template_id: r.brand_template_id,
            active_pack_config_id: r.id,
            is_default: true,
            selected_by: uid,
          });
          if (insErr) {
            log("error", `${tag} ${locName}: INSERT failed`, insErr);
            console.groupEnd();
            throw insErr;
          }
          inserted += 1;
          defaulted += 1;
          log("info", `${tag} ${locName}: inserted fresh default selection`);
          continue;
        }

        // CASE C — exactly ONE existing row with a different config_id. Repoint in place.
        // This is what prevents ghost-row accumulation; no DELETE needed.
        if (rows.length === 1) {
          const old = rows[0] as any;
          const { error: upErr } = await supabase
            .from("location_pack_selections")
            .update({
              active_pack_config_id: r.id,
              is_default: true,
              selected_by: uid,
              selected_at: new Date().toISOString(),
            })
            .eq("location_id", location_id)
            .eq("brand_template_id", r.brand_template_id)
            .eq("active_pack_config_id", old.active_pack_config_id);
          if (upErr) {
            log("error", `${tag} ${locName}: repoint failed`, upErr);
            console.groupEnd();
            throw upErr;
          }
          inserted += 1;
          defaulted += 1;
          log("info", `${tag} ${locName}: repointed existing row`, {
            from: old.active_pack_config_id,
            to: r.id,
            was_default: old.is_default,
          });
          continue;
        }

        // CASE D — multiple existing rows (legit multi-config: sack + case, 4-pack + gallon).
        // Refuse to auto-pick which one to overwrite. Loud warn + skip; a human chooses via a future UI.
        log("warn", `${tag} ${locName}: ${rows.length} existing selections for this template — refusing to auto-repoint. Skipping.`, {
          existing: rows.map((x: any) => ({ config_id: x.active_pack_config_id, is_default: x.is_default })),
          incoming: r.id,
        });
        skipped += 1;
      }
      log("info", `${tag} DONE — inserted=${inserted}, defaulted=${defaulted}, skipped=${skipped}, locCount=${locIds.length}`);

      // (4) AFTER snapshot — same query, diff per location
      if (vendorSku && locIds.length) {
        const { data: after } = await supabase
          .from("inventory_items")
          .select("location_id, item_number, cost_per_unit, last_synced_at, updated_at")
          .in("location_id", locIds)
          .eq("item_number", vendorSku);
        const afterSnap = after ?? [];
        const diff = afterSnap.map(a => {
          const b = beforeSnap.find(x => x.location_id === a.location_id);
          return {
            location: locs.find(l => l.id === a.location_id)?.name ?? a.location_id,
            before_cost: b?.cost_per_unit ?? null,
            after_cost: a.cost_per_unit,
            cost_changed: (b?.cost_per_unit ?? null) !== a.cost_per_unit,
            before_updated_at: b?.updated_at ?? null,
            after_updated_at: a.updated_at,
          };
        });
        console.table(diff);
        log("info", `${tag} STEP 4: AFTER snapshot — diff per location`, diff);
        const anyChanged = diff.some(d => d.cost_changed);
        log("info", `${tag} VERDICT: cost_per_unit changed by approve? → ${anyChanged ? "YES (unexpected)" : "NO (expected — approve does not rewrite cost)"}`);
      }
      log("info", `${tag} NOTE: inventory_items.cost_per_unit is NOT touched by approval. Per-location cost is rewritten only by the next PFG sync.`);
      console.groupEnd();
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

  // ---- Bulk runner ----
  const runBulk = async (action: "approve" | "reject") => {
    const ids = Array.from(effectiveSelected);
    if (ids.length === 0) return;
    const verb = action === "approve" ? "approve" : "reject";
    if (!confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${ids.length} proposal(s)?`)) return;
    const rowsById = new Map(proposalRows.map((r) => [r.id, r]));
    setBulkBusy(action);
    setBulkProgress({ done: 0, total: ids.length });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < ids.length; i++) {
      const r = rowsById.get(ids[i]);
      if (!r) { fail++; setBulkProgress({ done: i + 1, total: ids.length }); continue; }
      try {
        if (action === "approve") await approve.mutateAsync(r);
        else await reject.mutateAsync(r);
        ok++;
      } catch (e: any) {
        fail++;
        console.warn("[bulk]", action, "failed for", r.id, e?.message);
      }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    setBulkBusy(null);
    setBulkProgress(null);
    clearSelection();
    toast({
      title: `Bulk ${action} complete`,
      description: `${ok} succeeded, ${fail} failed.`,
      variant: fail > 0 ? "destructive" : undefined,
    });
    qc.invalidateQueries({ queryKey: ["pack-config-proposals", brandId] });
  };

  const allVisibleSelected =
    filteredRows.length > 0 && effectiveSelected.size === filteredRows.length;

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-5xl pb-24">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/brand/${brandId}/inventory`}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Pack Config Approvals</h1>
        <Badge variant="outline" className="ml-2">
          {filteredRows.length} of {proposalRows.length}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        Approving writes to <code>brand_pack_configs</code> and <code>location_pack_selections</code> only.
        Counts, items, and templates are not touched.
      </p>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Approval trace</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setApprovalLog([])}
              disabled={approvalLog.length === 0}
            >
              <X className="h-4 w-4" /> Clear log
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {approvalLog.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Hit <b>Approve</b> on a proposal and the full before/after trace will show here.
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
              {approvalLog.map((entry) => (
                <div key={entry.id} className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={
                        entry.level === "error"
                          ? "destructive"
                          : entry.level === "warn"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {entry.level}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">{entry.timestamp}</span>
                  </div>
                  <div className="text-sm">{entry.message}</div>
                  {entry.data !== undefined && (
                    <pre className="overflow-x-auto rounded-md border bg-background p-3 text-xs text-muted-foreground whitespace-pre-wrap break-all">
                      {typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoading && proposalRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-muted/30">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, SKU, pack..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Select value={vendorFilter} onValueChange={setVendorFilter}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Vendor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {vendorOptions.map((v) => (
                <SelectItem key={v} value={v}>{v.toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categoryOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none px-2">
            <Checkbox
              checked={competingOnly}
              onCheckedChange={(c) => setCompetingOnly(c === true)}
            />
            Competing only
          </label>
          {(vendorFilter !== "all" || categoryFilter !== "all" || query || competingOnly) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVendorFilter("all");
                setCategoryFilter("all");
                setQuery("");
                setCompetingOnly(false);
              }}
            >
              <X className="h-4 w-4" /> Clear
            </Button>
          )}
          <label className="ml-auto flex items-center gap-2 text-xs cursor-pointer select-none">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={(c) => (c === true ? selectAllVisible() : clearSelection())}
            />
            Select all visible
          </label>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading proposals...
        </div>
      )}

      {!isLoading && grouped.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            {proposalRows.length === 0 ? "No pending proposals." : "No proposals match your filters."}
          </CardContent>
        </Card>
      )}

      {grouped.map(({ template, rows }) => {
        const vendorSkus = Array.from(
          new Set(
            rows
              .map((r) => {
                const ev = (r.source_evidence || {}) as any;
                const vendor = ev.vendor ? String(ev.vendor).toUpperCase() : null;
                return ev.sku ? (vendor ? `${vendor} #${ev.sku}` : `#${ev.sku}`) : null;
              })
              .filter(Boolean) as string[]
          )
        );
        return (
        <Card key={template?.id ?? "x"}>
          <CardHeader className="pb-2 space-y-2">
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
            {vendorSkus.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap text-xs">
                <span className="text-muted-foreground">Vendor SKUs:</span>
                {vendorSkus.map((s) => (
                  <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((r) => {
              const d = getDraft(r);
              const ev = r.source_evidence || {};
              const isBusy = !!busy[r.id];
              const proposalLocs = locationsForProposal(r);
              return (
                <div key={r.id} className="rounded-lg border p-3 space-y-3 bg-muted/30">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Checkbox
                      checked={effectiveSelected.has(r.id)}
                      onCheckedChange={() => toggleSelect(r.id)}
                      aria-label="Select proposal"
                    />
                    <Badge variant={sourceVariant(r.source)}>{sourceLabel(r.source)}</Badge>
                    {ev.vendor && <span className="text-xs text-muted-foreground">vendor: <b>{ev.vendor}</b></span>}
                    {ev.territory && <span className="text-xs text-muted-foreground">territory: {ev.territory}</span>}
                    {ev.sku && <span className="text-xs font-mono text-muted-foreground">SKU {ev.sku}</span>}
                    {ev.packString && <span className="text-xs text-muted-foreground">pack: <code>{ev.packString}</code></span>}
                    {ev.costPerCase != null && (
                      <span className="text-xs text-muted-foreground">case ${Number(ev.costPerCase).toFixed(2)}</span>
                    )}
                  </div>
                  {proposalLocs.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap text-xs">
                      <span className="text-muted-foreground">Synced at:</span>
                      {proposalLocs.map((l) => (
                        <Badge key={l.id} variant="secondary" className="text-[10px]">{l.name}</Badge>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <Field label="Outer qty">
                      <Input type="number" value={d.outer_qty ?? ""} onChange={(e) => patchDraft(r.id, { outer_qty: Number(e.target.value) })} />
                    </Field>
                    <Field label="Outer type">
                      <OuterTypeSelect value={d.outer_type} onChange={(v) => patchDraft(r.id, { outer_type: v })} />
                    </Field>
                    <Field label="Inner qty">
                      <Input type="number" value={d.inner_qty ?? ""} onChange={(e) => patchDraft(r.id, { inner_qty: e.target.value === "" ? null : Number(e.target.value) })} />
                    </Field>
                    <Field label="Inner type">
                      <UnitSelect value={d.inner_type} allowNone onChange={(v) => patchDraft(r.id, { inner_type: v })} />
                    </Field>
                    <Field label="Common unit">
                      <UnitSelect value={d.common_unit} onChange={(v) => patchDraft(r.id, { common_unit: v ?? "" })} />
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
      );})}

      {/* Floating bulk action bar */}
      {effectiveSelected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border bg-background/95 backdrop-blur px-3 py-2 shadow-lg">
          <Badge variant="secondary" className="rounded-full">
            {effectiveSelected.size} selected
          </Badge>
          {bulkProgress && (
            <span className="text-xs text-muted-foreground px-1">
              {bulkProgress.done}/{bulkProgress.total}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={clearSelection}
            disabled={!!bulkBusy}
          >
            <X className="h-4 w-4" /> Clear
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => runBulk("reject")}
            disabled={!!bulkBusy}
          >
            {bulkBusy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            Reject {effectiveSelected.size}
          </Button>
          <Button
            size="sm"
            onClick={() => runBulk("approve")}
            disabled={!!bulkBusy}
          >
            {bulkBusy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve {effectiveSelected.size}
          </Button>
        </div>
      )}
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
