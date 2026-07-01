import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BookOpen } from "lucide-react";

interface Props { brandId: string; }

/** Brand-scope library toggle. Shown inside the Edit Brand dialog. */
export function LibraryEnableSection({ brandId }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("library_settings" as any)
        .select("brand_library_enabled")
        .eq("brand_id", brandId)
        .maybeSingle();
      if (alive) { setEnabled(!!(data as any)?.brand_library_enabled); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [brandId]);

  const toggle = async (v: boolean) => {
    setEnabled(v);
    const { data: existing } = await supabase
      .from("library_settings" as any).select("id").eq("brand_id", brandId).maybeSingle();
    const res = existing
      ? await supabase.from("library_settings" as any)
          .update({ brand_library_enabled: v, updated_at: new Date().toISOString() })
          .eq("id", (existing as any).id)
      : await supabase.from("library_settings" as any)
          .insert({ brand_id: brandId, brand_library_enabled: v } as any);
    if (res.error) { toast.error(res.error.message); setEnabled(!v); }
    else toast.success(`Brand Library ${v ? "enabled" : "disabled"}`);
  };

  if (loading) return null;

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4" />
        <Label className="font-medium">Brand Library</Label>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground pr-3">
          Enable a searchable recipe & document library for this brand. Editable only by brand admins.
        </p>
        <Switch checked={enabled} onCheckedChange={toggle} />
      </div>
    </div>
  );
}
