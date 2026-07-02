import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
  /** Placeholder text shown when value is empty. Default: "add pack" */
  placeholder?: string;
  /** Optional additional className for the trigger. */
  className?: string;
}

/**
 * Inline pack_size editor. Click to edit, Enter to save, Esc/blur to cancel.
 * Renders as a badge (matching existing pack_size badges) when set, or a
 * subtle "+ add pack" affordance when empty. Shared by both the invoice
 * line-item drawer and the Items list.
 */
export default function PackSizeInlineEdit({ value, onSave, placeholder = "add pack", className }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value ?? "");
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, value]);

  const commit = async () => {
    const next = draft.trim();
    const normalized = next.length === 0 ? null : next;
    if (normalized === (value ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(normalized);
      setEditing(false);
    } catch {
      // Leave the editor open so the user can retry; upstream toasts the error.
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          }}
          disabled={saving}
          placeholder="e.g. 10/12 CT"
          className="h-6 text-[11px] font-mono w-32 px-2"
        />
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <button
              type="button"
              onClick={commit}
              className="text-emerald-600 hover:text-emerald-700"
              aria-label="Save pack size"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </span>
    );
  }

  if (value) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className={cn("inline-flex items-center gap-1 group", className)}
        aria-label="Edit pack size"
      >
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-mono group-hover:bg-muted">
          {value}
        </Badge>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={cn(
        "text-[10px] text-muted-foreground/70 hover:text-foreground inline-flex items-center gap-1 border border-dashed border-border/60 rounded px-1.5 h-4",
        className,
      )}
      aria-label="Add pack size"
    >
      <Pencil className="h-2.5 w-2.5" />
      {placeholder}
    </button>
  );
}
