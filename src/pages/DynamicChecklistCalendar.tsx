import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import {
  ArrowLeft, Save, Plus, X, Trash2, Camera, Eye, Sun, Moon,
  ListPlus, Library, Archive, Pencil, Check,
} from "lucide-react";

import { useLocation } from "@/hooks/useLocation";
import { AssigneePicker } from "@/components/shared/AssigneePicker";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Only these lowercase types are ever written from this editor. */
const EDITOR_TYPES = [
  { value: "confirmation", label: "Check" },
  { value: "image", label: "Photo" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "multiple_choice", label: "Multiple choice" },
] as const;

type EditorType = (typeof EDITOR_TYPES)[number]["value"];

const typeLabel = (t: string) =>
  EDITOR_TYPES.find((x) => x.value === t)?.label ?? t;

interface ChecklistItem {
  id: string;
  question: string;
  item_type: string;
  order_index: number;
  days_of_week: number[];
  reference_image_url: string | null;
  reference_notes: string | null;
  manager_shift: "am" | "pm" | null;
  options: any;
  forked_from_item_id: string | null;
}

const normalizeItem = (row: any): ChecklistItem => ({
  id: row.id,
  question: row.question,
  item_type: row.item_type,
  order_index: row.order_index ?? 0,
  days_of_week: Array.isArray(row.days_of_week) ? row.days_of_week : [],
  reference_image_url: row.reference_image_url ?? null,
  reference_notes: row.reference_notes ?? null,
  manager_shift: row.manager_shift === "am" || row.manager_shift === "pm" ? row.manager_shift : null,
  options: row.options ?? null,
  forked_from_item_id: row.forked_from_item_id ?? null,
});

/** Mon=0 .. Sun=6 — matches getDateDayOfWeekInTimezone */
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const getOptionsArray = (options: any): string[] =>
  Array.isArray(options) ? options : Array.isArray(options?.choices) ? options.choices : [];

const getMinPhotos = (options: any): number => {
  const n = options && !Array.isArray(options) ? Number(options.minPhotos) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/* ------------------------------------------------------------------ */
/* Smart Tap dialog — one component on every breakpoint                */
/* Pattern: MobileAddScheduleSheet "SMART TAP DIALOG (centered, fixed)" */
/* ------------------------------------------------------------------ */

function LibraryTapDialog({
  open,
  onOpenChange,
  dayLabel,
  items,
  recentIds,
  placedIds,
  onPlace,
  onNewItem,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dayLabel: string;
  items: ChecklistItem[];
  recentIds: string[];
  placedIds: Set<string>;
  onPlace: (item: ChecklistItem) => void;
  onNewItem: () => void;
}) {
  const ordered = useMemo(() => {
    const rec: ChecklistItem[] = [];
    for (const id of recentIds) {
      const it = items.find((i) => i.id === id);
      if (it) rec.push(it);
    }
    const recIds = new Set(rec.map((i) => i.id));
    return [...rec, ...items.filter((i) => !recIds.has(i.id))];
  }, [items, recentIds]);

  const recentSet = useMemo(() => new Set(recentIds.slice(0, 3)), [recentIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(340px,92vw)] max-w-[min(340px,92vw)] max-h-[70vh] overflow-y-auto p-2 gap-2 rounded-2xl pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-2 pt-1 pb-0">
          <DialogTitle className="text-sm font-medium text-center">{dayLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1">
          <button
            type="button"
            onClick={onNewItem}
            className="w-full min-h-[44px] flex items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary hover:bg-accent/40 transition-colors"
            aria-label="Create new library item"
          >
            <Plus className="h-4 w-4" /> New item
          </button>

          <div className="space-y-0.5 pt-1">
            {ordered.map((it) => (
              <LibraryOption
                key={it.id}
                item={it}
                onSelect={onPlace}
                highlighted={recentSet.has(it.id)}
                placed={placedIds.has(it.id)}
              />
            ))}
            {ordered.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground text-center">
                Your library is empty — add an item first.
              </p>
            )}
          </div>
        </div>

        <div className="pt-1">
          <Button variant="outline" size="sm" className="w-full" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LibraryOption({
  item,
  onSelect,
  highlighted = false,
  placed = false,
}: {
  item: ChecklistItem;
  onSelect: (i: ChecklistItem) => void;
  highlighted?: boolean;
  placed?: boolean;
}) {
  return (
    <button
      type="button"
      className={`w-full min-h-[44px] flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-accent/70 ${
        highlighted ? "bg-accent/30" : ""
      }`}
      onClick={() => onSelect(item)}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold leading-tight text-foreground truncate">{item.question}</p>
        <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mt-0.5 leading-tight truncate">
          {typeLabel(item.item_type)}
          {item.days_of_week.length === 0 ? " · unused" : ` · ${item.days_of_week.length}d`}
        </p>
      </div>
      {placed && <Check className="h-4 w-4 text-primary shrink-0" />}
    </button>
  );
}


/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DynamicChecklistCalendar() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { currentLocation } = useLocation();

  const isNew = routeId === "new";
  const [checklistId, setChecklistId] = useState<string | null>(isNew ? null : routeId ?? null);
  const [title, setTitle] = useState(isNew ? "" : "");
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [openDayPopover, setOpenDayPopover] = useState<number | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Title: heading + pencil. Name commits immediately; everything else waits for Save.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");


  // Item sheet
  const [sheetItem, setSheetItem] = useState<ChecklistItem | null>(null);
  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<ChecklistItem | null>(null);
  const [archiveResponses, setArchiveResponses] = useState<number | null>(null);

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate("/tasks");
      toast.error("Access denied. Only admins can manage dynamic checklists.");
    }
  }, [isAdmin, roleLoading, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    if (isNew) {
      setLoading(false);
      return;
    }
    if (checklistId) fetchData(checklistId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, checklistId, isNew]);

  const fetchData = async (cid: string) => {
    try {
      setLoading(true);
      const [{ data: cl, error: clErr }, { data: rows, error: rowsErr }] = await Promise.all([
        supabase.from("checklists").select("*").eq("id", cid).single(),
        supabase
          .from("checklist_items")
          .select("*")
          .eq("checklist_id", cid)
          .is("deleted_at", null)
          .order("order_index"),
      ]);
      if (clErr) throw clErr;
      if (rowsErr) throw rowsErr;
      setTitle(cl.title ?? "");
      setItems((rows || []).map(normalizeItem));

      const [{ data: roleTags }, { data: userTags }] = await Promise.all([
        supabase.from("checklist_role_tags").select("role").eq("checklist_id", cid),
        supabase.from("checklist_user_tags").select("user_id").eq("checklist_id", cid),
      ]);
      setSelectedRoles((roleTags ?? []).map((r: any) => r.role));
      setSelectedUserIds((userTags ?? []).map((u: any) => u.user_id));
    } catch (e) {
      console.error(e);
      toast.error("Failed to load checklist");
      navigate("/tasks");
    } finally {
      setLoading(false);
    }
  };

  /** Creates the checklists row lazily — never on mount. */
  const ensureChecklist = useCallback(async (): Promise<string | null> => {
    if (checklistId) return checklistId;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("You need to be signed in");
      return null;
    }
    if (!currentLocation?.id) {
      toast.error("Pick a location before creating a template");
      return null;
    }
    const { data, error } = await supabase
      .from("checklists")
      .insert({
        title: title.trim() || "New Dynamic Template",
        description: "Weekly template",
        template_type: "dynamic",
        frequency: "weekly",
        created_by: user.id,
        location_id: currentLocation.id,
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      toast.error("Failed to create template");
      return null;
    }
    setChecklistId(data.id);
    navigate(`/dynamic-checklist/${data.id}`, { replace: true });
    return data.id;
  }, [checklistId, currentLocation?.id, navigate, title]);

  /* ---------------- derived ---------------- */

  const byDay = useMemo(() => {
    const map = new Map<number, ChecklistItem[]>();
    for (let d = 0; d < 7; d++) map.set(d, []);
    for (const it of items) {
      for (const d of it.days_of_week) map.get(d)?.push(it);
    }
    return map;
  }, [items]);

  const unusedCount = items.filter((i) => i.days_of_week.length === 0).length;

  const placedIdsForOpenDay = useMemo(
    () => new Set((openDayPopover !== null ? byDay.get(openDayPopover) ?? [] : []).map((i) => i.id)),
    [byDay, openDayPopover],
  );

  /* ---------------- title (immediate save) ---------------- */

  const cancelTitle = () => {
    setEditingTitle(false);
    setTitleDraft(title);
  };

  const commitTitle = async () => {
    const next = titleDraft.trim();
    if (!next) {
      toast.error("Give the template a name");
      cancelTitle();
      return;
    }
    setEditingTitle(false);
    if (next === title) return;
    const cid = await ensureChecklist();
    if (!cid) {
      cancelTitle();
      return;
    }
    const { error } = await supabase.from("checklists").update({ title: next }).eq("id", cid);
    if (error) {
      console.error(error);
      toast.error("Could not rename the template");
      cancelTitle();
      return;
    }
    setTitle(next);
    toast.success("Name saved");
  };


  /* ---------------- mutations ---------------- */

  const bumpRecent = (itemId: string) =>
    setRecentIds((prev) => [itemId, ...prev.filter((i) => i !== itemId)].slice(0, 3));

  const createLibraryItem = async (question: string, itemType: EditorType) => {
    const cid = await ensureChecklist();
    if (!cid) return null;
    const { data, error } = await supabase
      .from("checklist_items")
      .insert({
        checklist_id: cid,
        question: question.trim(),
        item_type: itemType,
        order_index: items.length,
        is_required: true,
        days_of_week: [],
        options: itemType === "multiple_choice" ? ["Yes", "No"] : null,
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      toast.error("Could not add that item");
      return null;
    }
    const item = normalizeItem(data);
    setItems((prev) => [...prev, item]);
    return item;
  };

  const persistDays = async (item: ChecklistItem, days: number[]) => {
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    const { error } = await supabase
      .from("checklist_items")
      .update({ days_of_week: sorted })
      .eq("id", item.id);
    if (error) {
      console.error(error);
      toast.error("Could not update days");
      return false;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, days_of_week: sorted } : i)));
    setSheetItem((s) => (s && s.id === item.id ? { ...s, days_of_week: sorted } : s));
    return true;
  };

  const duplicateOnDay = (item: ChecklistItem, day: number) =>
    items.find(
      (i) =>
        i.id !== item.id &&
        i.question.trim().toLowerCase() === item.question.trim().toLowerCase() &&
        i.days_of_week.includes(day),
    );

  const placeOnDay = async (item: ChecklistItem, day: number) => {
    if (item.days_of_week.includes(day)) {
      toast.info(`Already on ${DAY_NAMES[day]}`);
      return;
    }
    const dupe = duplicateOnDay(item, day);
    if (dupe && !window.confirm(`"${item.question}" is already on ${DAY_NAMES[day]} as another item. Add it anyway?`)) {
      return;
    }
    const ok = await persistDays(item, [...item.days_of_week, day]);
    if (ok) {
      bumpRecent(item.id);
      toast.success(`Added to ${DAY_NAMES[day]}`);
    }
  };

  const removeFromDay = async (item: ChecklistItem, day: number) => {
    const next = item.days_of_week.filter((d) => d !== day);
    const prevDays = item.days_of_week;
    const ok = await persistDays(item, next);
    if (!ok) return;
    if (next.length === 0) {
      toast("Moved to Unused", {
        description: `"${item.question}" is still in your library.`,
        action: { label: "Undo", onClick: () => persistDays(item, prevDays) },
      });
    }
  };

  const forkToDay = async (item: ChecklistItem, day: number) => {
    const cid = checklistId;
    if (!cid) return;
    const { data, error } = await supabase
      .from("checklist_items")
      .insert({
        checklist_id: cid,
        question: item.question,
        item_type: item.item_type,
        order_index: items.length,
        is_required: true,
        days_of_week: [day],
        options: item.options,
        manager_shift: item.manager_shift,
        reference_image_url: item.reference_image_url,
        reference_notes: item.reference_notes,
        forked_from_item_id: item.id,
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      toast.error("Could not copy that item");
      return;
    }
    setItems((prev) => [...prev, normalizeItem(data)]);
    toast.success(`${DAY_NAMES[day]} copy created`, {
      description: `Edits here will not change ${item.days_of_week.length ? DAY_NAMES[item.days_of_week[0]] : "the original"}.`,
    });
  };

  const openArchive = async (item: ChecklistItem) => {
    setArchiveTarget(item);
    setArchiveResponses(null);
    const { count } = await supabase
      .from("checklist_responses")
      .select("id", { count: "exact", head: true })
      .eq("item_id", item.id);
    setArchiveResponses(count ?? 0);
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const { error } = await supabase
      .from("checklist_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", archiveTarget.id);
    if (error) {
      console.error(error);
      toast.error("Could not archive that item");
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== archiveTarget.id));
    if (sheetItem?.id === archiveTarget.id) setSheetItem(null);
    toast.success("Item archived", { description: "Past completions were kept." });
    setArchiveTarget(null);
  };

  const patchItem = async (item: ChecklistItem, patch: Partial<ChecklistItem> & Record<string, any>) => {
    const { error } = await supabase.from("checklist_items").update(patch).eq("id", item.id);
    if (error) {
      console.error(error);
      toast.error("Could not save that change");
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } as ChecklistItem : i)));
    setSheetItem((s) => (s && s.id === item.id ? ({ ...s, ...patch } as ChecklistItem) : s));
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Please give the template a name");
      return;
    }
    setSaving(true);
    try {
      const cid = await ensureChecklist();
      if (!cid) return;
      const { error } = await supabase.from("checklists").update({ title: trimmed }).eq("id", cid);
      if (error) throw error;

      await supabase.from("checklist_role_tags").delete().eq("checklist_id", cid);
      await supabase.from("checklist_user_tags").delete().eq("checklist_id", cid);
      if (selectedRoles.length > 0) {
        await supabase
          .from("checklist_role_tags")
          .insert(selectedRoles.map((role) => ({ checklist_id: cid, role: role as any })));
      }
      if (selectedUserIds.length > 0) {
        await supabase
          .from("checklist_user_tags")
          .insert(selectedUserIds.map((user_id) => ({ checklist_id: cid, user_id })));
      }
      toast.success("Weekly template saved");
      navigate("/tasks");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  if (roleLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading...</p>
        </div>
      </Layout>
    );
  }
  if (!isAdmin) return null;

  const libraryPanel = (
    <LibraryPanel
      items={items}
      unusedCount={unusedCount}
      onCreate={createLibraryItem}
      onEdit={(it) => setSheetItem(it)}
      onArchive={openArchive}
    />
  );

  return (
    <Layout>
      <div className="container mx-auto p-4 sm:p-6 max-w-7xl space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate("/tasks")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>

            {editingTitle ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <Input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitTitle();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelTitle();
                    }
                  }}
                  onBlur={cancelTitle}
                  placeholder="Template name (e.g. Weekly Cleaning)"
                  className="text-xl sm:text-2xl font-bold h-auto py-1 px-2 min-w-0"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-10 w-10"
                  aria-label="Save name"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={commitTitle}
                >
                  <Check className="h-5 w-5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold leading-tight break-words min-w-0">
                  {title || "Untitled template"}
                </h1>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-10 w-10"
                  aria-label="Rename template"
                  onClick={() => {
                    setTitleDraft(title);
                    setEditingTitle(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2 shrink-0">
              {/* Library sheet — mobile */}
              <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="lg:hidden">
                    <Library className="h-4 w-4 mr-1.5" />
                    Library
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
                  <SheetHeader className="mb-3">
                    <SheetTitle>Library</SheetTitle>
                  </SheetHeader>
                  {libraryPanel}
                </SheetContent>
              </Sheet>
              <Button onClick={handleSave} disabled={saving} size="sm">
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>

          <p className="text-muted-foreground text-sm w-full">
            Tap a day to place items from your library
          </p>
        </div>

        <Card className="p-4">
          <AssigneePicker
            locationId={currentLocation?.id}
            selectedRoles={selectedRoles}
            onRolesChange={setSelectedRoles}
            selectedUserIds={selectedUserIds}
            onUserIdsChange={setSelectedUserIds}
            label="Visible to"
            helperText="Roles auto-include everyone in that role. Add specific people to grant access without changing their role. Saves with the template."
          />
        </Card>

        <div className="grid lg:grid-cols-4 gap-4">
          {/* Library — desktop column */}
          <Card className="p-4 hidden lg:block lg:col-span-1 h-fit min-w-0">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Library className="h-4 w-4" /> Library
            </h2>
            {libraryPanel}
          </Card>

          {/* Week */}
          <div className="lg:col-span-3 min-w-0">
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
            >
              {DAY_NAMES.map((dayName, dayIdx) => {
                const dayItems = byDay.get(dayIdx) || [];
                return (
                  <Card key={dayIdx} className="p-3 min-h-[180px] min-w-0 flex flex-col">
                    <div className="flex items-center justify-between mb-1 gap-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate min-w-0">{dayName}</h3>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0"
                        title="Add item to this day"
                        aria-label={`Add item to ${dayName}`}
                        onClick={() => setOpenDayPopover(dayIdx)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Thin count strip */}
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1 mb-2">
                      {dayItems.length} {dayItems.length === 1 ? "item" : "items"}
                    </div>

                    <div className="space-y-1.5 flex-1 min-w-0">
                      {dayItems.map((it) => (
                        <button
                          key={`${dayIdx}-${it.id}`}
                          type="button"
                          onClick={() => setSheetItem(it)}
                          className="w-full min-w-0 text-left px-2 py-1.5 rounded-md border bg-card hover:bg-accent/60 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-medium truncate flex-1 min-w-0">{it.question}</span>
                            {it.manager_shift === "am" && <Sun className="h-3 w-3 text-amber-500 shrink-0" />}
                            {it.manager_shift === "pm" && <Moon className="h-3 w-3 text-indigo-500 shrink-0" />}
                          </div>
                          <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground mt-0.5 truncate">
                            {typeLabel(it.item_type)}
                            {it.forked_from_item_id ? " · copy" : ""}
                          </p>
                        </button>
                      ))}
                      {dayItems.length === 0 && (
                        <button
                          type="button"
                          onClick={() => setOpenDayPopover(dayIdx)}
                          className="w-full h-16 rounded-md border-2 border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                        >
                          Tap to add
                        </button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>

        {/* Smart Tap — one centered dialog for every day / breakpoint */}
        <LibraryTapDialog
          open={openDayPopover !== null}
          onOpenChange={(o) => !o && setOpenDayPopover(null)}
          dayLabel={openDayPopover !== null ? DAY_NAMES[openDayPopover] : ""}
          items={items}
          recentIds={recentIds}
          placedIds={placedIdsForOpenDay}
          onPlace={(it) => {
            if (openDayPopover !== null) placeOnDay(it, openDayPopover);
          }}
          onNewItem={() => {
            setOpenDayPopover(null);
            setLibraryOpen(true);
          }}
        />
      </div>




      {/* Item sheet */}
      <ItemSheet
        item={sheetItem}
        onClose={() => setSheetItem(null)}
        onToggleDay={async (day) => {
          if (!sheetItem) return;
          if (sheetItem.days_of_week.includes(day)) {
            await removeFromDay(sheetItem, day);
          } else {
            await placeOnDay(sheetItem, day);
          }
        }}
        onPatch={(patch) => sheetItem && patchItem(sheetItem, patch)}
        onArchive={() => sheetItem && openArchive(sheetItem)}
      />

      {/* Archive confirm */}
      <Dialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <DialogContent className="max-w-md max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle className="text-base">Archive this item?</DialogTitle>
            <DialogDescription className="text-xs">
              "{archiveTarget?.question}" will stop showing up for the crew.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Tagged on:{" "}
              <span className="text-foreground font-medium">
                {archiveTarget && archiveTarget.days_of_week.length > 0
                  ? archiveTarget.days_of_week.map((d) => DAY_SHORT[d]).join(", ")
                  : "no days (unused)"}
              </span>
            </p>
            <p className="text-muted-foreground">
              Completions on record:{" "}
              <span className="text-foreground font-medium">
                {archiveResponses === null ? "checking..." : archiveResponses}
              </span>
            </p>
            <div className="rounded-md bg-muted/60 p-3 space-y-1.5 text-xs text-muted-foreground">
              <p>The crew stops seeing it right away — nobody will do it again today.</p>
              <p>This week's score still has the hole where it was, so the percentage won't jump.</p>
              <p>Starting Monday it isn't expected at all.</p>
              <p>No overdue reminder will go out for it.</p>
              <p>Nothing is erased — past completions stay, and copies of this item are untouched.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setArchiveTarget(null)}>
              Keep it
            </Button>
            <Button onClick={confirmArchive}>
              <Archive className="h-4 w-4 mr-2" /> Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

/* ------------------------------------------------------------------ */
/* Library panel                                                       */
/* ------------------------------------------------------------------ */

function LibraryPanel({
  items,
  unusedCount,
  onCreate,
  onEdit,
  onArchive,
}: {
  items: ChecklistItem[];
  unusedCount: number;
  onCreate: (q: string, t: EditorType) => Promise<ChecklistItem | null>;
  onEdit: (i: ChecklistItem) => void;
  onArchive: (i: ChecklistItem) => void;
}) {
  const [question, setQuestion] = useState("");
  const [type, setType] = useState<EditorType>("confirmation");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    const created = await onCreate(question, type);
    setBusy(false);
    if (created) {
      setQuestion("");
      toast.success("Added to library");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 pb-3 border-b">
        <Input
          placeholder="What needs doing?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Select value={type} onValueChange={(v) => setType(v as EditorType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EDITOR_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={add} className="w-full" size="sm" disabled={busy || !question.trim()}>
          <ListPlus className="h-4 w-4 mr-2" /> Add to library
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
        {unusedCount > 0 && <Badge variant="secondary">Unused ({unusedCount})</Badge>}
      </div>

      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.id} className="group flex items-center gap-1 px-2 py-1.5 rounded-md border bg-card">
            <button type="button" className="flex-1 min-w-0 text-left" onClick={() => onEdit(it)}>
              <p className="text-sm truncate">{it.question}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {typeLabel(it.item_type)}
                {it.days_of_week.length === 0
                  ? " · unused"
                  : ` · ${it.days_of_week.map((d) => DAY_SHORT[d]).join(" ")}`}
                {it.forked_from_item_id ? " · copy" : ""}
              </p>
            </button>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onEdit(it)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onArchive(it)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">Nothing here yet. Add your first item above.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Item sheet                                                          */
/* ------------------------------------------------------------------ */

function ItemSheet({
  item,
  onClose,
  onToggleDay,
  onPatch,
  onArchive,
}: {
  item: ChecklistItem | null;
  onClose: () => void;
  onToggleDay: (day: number) => void;
  onPatch: (patch: Record<string, any>) => void;
  onArchive: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [choicesText, setChoicesText] = useState("");

  useEffect(() => {
    if (!item) return;
    setName(item.question);
    setNotes(item.reference_notes ?? "");
    setChoicesText(getOptionsArray(item.options).join("\n"));
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;

  const dayCount = item.days_of_week.length;
  const appliesLine =
    dayCount === 0
      ? "Not on any day yet — it stays in the library"
      : dayCount === 1
      ? `Applies to ${DAY_NAMES[item.days_of_week[0]]} only`
      : `Applies to ${dayCount} days`;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileName = `checklist-refs/${item.id}-${Date.now()}.${file.name.split(".").pop()}`;
      const { error } = await supabase.storage.from("checklist-images").upload(fileName, file);
      if (error) throw error;
      const { data } = supabase.storage.from("checklist-images").getPublicUrl(fileName);
      onPatch({ reference_image_url: data.publicUrl });
    } catch (err) {
      console.error(err);
      toast.error("Failed to upload photo");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <>
      <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="bottom" className="h-[90vh] overflow-y-auto">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle className="text-base pr-8 truncate">{item.question}</SheetTitle>
            <p className="text-xs text-muted-foreground">{appliesLine}</p>
          </SheetHeader>

          <div className="space-y-5 pb-8">
            {/* Days first */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Days</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAY_SHORT.map((d, idx) => {
                  const active = item.days_of_week.includes(idx);
                  return (
                    <Button
                      key={idx}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="rounded-full px-3"
                      onClick={() => onToggleDay(idx)}
                    >
                      {d}
                    </Button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Settings below apply to every day this item is tagged on.

              </p>
            </div>

            {/* Shift */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Shift</Label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={item.manager_shift === null ? "default" : "outline"}
                  onClick={() => onPatch({ manager_shift: null })}
                >
                  Any
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={item.manager_shift === "am" ? "default" : "outline"}
                  onClick={() => onPatch({ manager_shift: "am" })}
                >
                  <Sun className="h-3.5 w-3.5 mr-1" /> AM
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={item.manager_shift === "pm" ? "default" : "outline"}
                  onClick={() => onPatch({ manager_shift: "pm" })}
                >
                  <Moon className="h-3.5 w-3.5 mr-1" /> PM
                </Button>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name !== item.question && onPatch({ question: name.trim() })}
              />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Type</Label>
              <Select
                value={item.item_type}
                onValueChange={(v) =>
                  onPatch({
                    item_type: v,
                    options:
                      v === "multiple_choice"
                        ? getOptionsArray(item.options).length
                          ? getOptionsArray(item.options)
                          : ["Yes", "No"]
                        : v === "image"
                        ? { minPhotos: getMinPhotos(item.options) }
                        : null,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITOR_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {item.item_type === "image" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Photos required</Label>
                <Input
                  type="number"
                  min={1}
                  value={getMinPhotos(item.options)}
                  onChange={(e) =>
                    onPatch({ options: { minPhotos: Math.max(1, parseInt(e.target.value || "1", 10)) } })
                  }
                  className="w-24"
                />
              </div>
            )}

            {item.item_type === "multiple_choice" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Choices (one per line)</Label>
                <Textarea
                  value={choicesText}
                  onChange={(e) => setChoicesText(e.target.value)}
                  onBlur={() =>
                    onPatch({
                      options: choicesText
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="min-h-[90px] text-sm"
                />
              </div>
            )}

            {/* Reference standard */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Reference standard</Label>
              {item.reference_image_url ? (
                <div className="relative">
                  <img
                    src={item.reference_image_url}
                    alt="Reference"
                    className="rounded-lg w-full max-h-48 object-cover border"
                  />
                  <div className="absolute top-2 right-2 flex gap-1">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-7 w-7 bg-background/80"
                      onClick={() => setPreviewOpen(true)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onPatch({ reference_image_url: null })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleUpload}
                  />
                  <Button
                    variant="outline"
                    className="w-full h-20 border-dashed flex flex-col gap-1"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <span className="text-sm text-muted-foreground">Uploading...</span>
                    ) : (
                      <>
                        <Camera className="h-5 w-5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Tap to add photo</span>
                      </>
                    )}
                  </Button>
                </div>
              )}
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => onPatch({ reference_notes: notes.trim() || null })}
                placeholder="Describe what done looks like..."
                className="min-h-[70px] text-sm"
              />
            </div>

            <Button variant="outline" className="w-full text-destructive" onClick={onArchive}>
              <Archive className="h-4 w-4 mr-2" /> Archive item
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <img
            src={item.reference_image_url || ""}
            alt="Reference preview"
            className="w-full max-h-[70vh] object-contain rounded"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
