import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BookOpen } from "lucide-react";

interface Props { organizationId: string; }

/** Org-scope library toggle. Shown on Organization Profile. */
export function OrgLibraryEnableSection({ organizationId }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("library_settings" as any)
        .select("org_library_enabled")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (alive) { setEnabled(!!(data as any)?.org_library_enabled); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [organizationId]);

  const toggle = async (v: boolean) => {
    setEnabled(v);
    const { data: existing } = await supabase
      .from("library_settings" as any).select("id").eq("organization_id", organizationId).maybeSingle();
    const res = existing
      ? await supabase.from("library_settings" as any)
          .update({ org_library_enabled: v, updated_at: new Date().toISOString() })
          .eq("id", (existing as any).id)
      : await supabase.from("library_settings" as any)
          .insert({ organization_id: organizationId, org_library_enabled: v } as any);
    if (res.error) { toast.error(res.error.message); setEnabled(!v); }
    else toast.success(`Org Library ${v ? "enabled" : "disabled"}`);
  };

  if (loading) return null;

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4" />
        <Label className="font-medium">Org Library</Label>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground pr-3">
          Enable a searchable recipe & document library for this organization. Editable only by org admins and above.
        </p>
        <Switch checked={enabled} onCheckedChange={toggle} />
      </div>
    </div>
  );
}
