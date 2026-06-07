import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const FLAG_TAGS = [
  { value: "wrong_cost", label: "Wrong cost" },
  { value: "wrong_pack", label: "Wrong pack" },
  { value: "missing_config", label: "Missing config" },
  { value: "wrong_unit", label: "Wrong unit" },
  { value: "other", label: "Other" },
] as const;

export function tagLabel(tag: string) {
  return FLAG_TAGS.find((t) => t.value === tag)?.label ?? "Other";
}

interface SandboxFlagButtonProps {
  countId: string;
  inventoryItemId: string;
  itemName?: string;
  /** Required — owner of the sandbox count (auth.uid()) */
  sandboxOwner: string;
  /** Compact icon-only render. */
  compact?: boolean;
}

/**
 * Per-item flag + sticky note for sandbox counts only.
 * Render guard: caller must ensure count.is_sandbox = true before mounting.
 */
export function SandboxFlagButton({
  countId,
  inventoryItemId,
  itemName,
  sandboxOwner,
  compact = false,
}: SandboxFlagButtonProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const { data: flag } = useQuery({
    queryKey: ["sandbox-flag", countId, inventoryItemId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sandbox_item_flags")
        .select("*")
        .eq("count_id", countId)
        .eq("inventory_item_id", inventoryItemId)
        .maybeSingle();
      return data;
    },
  });

  const [tag, setTag] = useState<string>("other");
  const [note, setNote] = useState<string>("");

  // Sync when opening
  const openDialog = () => {
    setTag(flag?.tag ?? "other");
    setNote(flag?.note ?? "");
    setOpen(true);
  };

  const upsertMut = useMutation({
    mutationFn: async () => {
      const payload = {
        count_id: countId,
        inventory_item_id: inventoryItemId,
        sandbox_owner: sandboxOwner,
        tag,
        note,
        created_by: user?.id ?? null,
      };
      const { error } = await supabase
        .from("sandbox_item_flags")
        .upsert(payload, { onConflict: "count_id,inventory_item_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sandbox-flag", countId, inventoryItemId] });
      qc.invalidateQueries({ queryKey: ["sandbox-flags", countId] });
      toast.success("Flag saved");
      setOpen(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save flag"),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!flag?.id) return;
      const { error } = await supabase
        .from("sandbox_item_flags")
        .delete()
        .eq("id", flag.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sandbox-flag", countId, inventoryItemId] });
      qc.invalidateQueries({ queryKey: ["sandbox-flags", countId] });
      toast.success("Flag removed");
      setOpen(false);
    },
  });

  const flagged = !!flag;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openDialog();
        }}
        className={cn(
          "inline-flex items-center justify-center rounded-md transition-colors flex-shrink-0",
          compact ? "h-6 w-6" : "h-7 px-2 gap-1 text-xs",
          flagged
            ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60"
            : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        title={flagged ? `Flagged: ${tagLabel(flag!.tag)}` : "Flag this item"}
        aria-label="Flag suspicious item"
      >
        <Flag className={compact ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} fill={flagged ? "currentColor" : "none"} />
        {!compact && (flagged ? "Flagged" : "Flag")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="h-4 w-4 text-amber-500" fill="currentColor" />
              Sandbox flag {itemName ? `— ${itemName}` : ""}
            </DialogTitle>
            <DialogDescription>
              Sticky note for this item in this sandbox count. Owner-only.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Category</label>
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLAG_TAGS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Note</label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What looks wrong? e.g. cost showing $0 but vendor invoice has $4.20/ea"
                rows={5}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            {flagged && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive mr-auto"
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
              >
                Remove flag
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => upsertMut.mutate()} disabled={upsertMut.isPending}>
              {upsertMut.isPending ? "Saving..." : flagged ? "Update" : "Flag item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
