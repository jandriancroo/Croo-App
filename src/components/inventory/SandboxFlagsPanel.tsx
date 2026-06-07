import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Flag, Copy, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { tagLabel } from "./SandboxFlagButton";
import { toast } from "sonner";

interface SandboxFlagsPanelProps {
  countId: string;
}

/**
 * Review-page summary of all flagged items in this sandbox count.
 * Renders nothing when there are no flags.
 */
export function SandboxFlagsPanel({ countId }: SandboxFlagsPanelProps) {
  const [copied, setCopied] = useState(false);

  const { data: flags } = useQuery({
    queryKey: ["sandbox-flags", countId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sandbox_item_flags")
        .select("id, tag, note, inventory_item_id, updated_at, inventory_items(name, item_number, pack_size)")
        .eq("count_id", countId)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const promptText = useMemo(() => {
    if (!flags?.length) return "";
    const lines = flags.map((f: any) => {
      const it = f.inventory_items;
      const name = it?.name ?? "(unknown item)";
      const num = it?.item_number ? `#${it.item_number}` : "";
      const pack = it?.pack_size ? ` · ${it.pack_size}` : "";
      return `- [${tagLabel(f.tag)}] ${name} ${num}${pack}\n  ${f.note || "(no note)"}`;
    });
    return `Sandbox flags from count ${countId}:\n\n${lines.join("\n\n")}`;
  }, [flags, countId]);

  if (!flags?.length) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    toast.success("Copied — paste into the fix prompt");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="p-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flag className="h-4 w-4 text-amber-600" fill="currentColor" />
          <h3 className="font-semibold text-sm">
            Sandbox flags <span className="text-muted-foreground">({flags.length})</span>
          </h3>
        </div>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
          Copy to fix prompt
        </Button>
      </div>
      <div className="space-y-2">
        {flags.map((f: any) => {
          const it = f.inventory_items;
          return (
            <div
              key={f.id}
              className="rounded-md bg-background/60 border border-amber-200/50 dark:border-amber-800/40 p-2.5"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{it?.name ?? "(unknown)"}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {it?.item_number ? `#${it.item_number}` : ""}
                    {it?.pack_size ? ` · ${it.pack_size}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] flex-shrink-0">
                  {tagLabel(f.tag)}
                </Badge>
              </div>
              {f.note && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{f.note}</p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Tiny pill for the sandbox banner. */
export function SandboxFlagsCounter({ countId }: { countId: string }) {
  const { data: count } = useQuery({
    queryKey: ["sandbox-flags-count", countId],
    queryFn: async () => {
      const { count } = await supabase
        .from("sandbox_item_flags")
        .select("*", { count: "exact", head: true })
        .eq("count_id", countId);
      return count ?? 0;
    },
  });
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[11px] font-medium px-2 py-0.5">
      <Flag className="h-3 w-3" fill="currentColor" />
      {count} flagged
    </span>
  );
}
