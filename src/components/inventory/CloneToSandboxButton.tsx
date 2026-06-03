import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Beaker } from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/useUserRole";

/**
 * Super-admin-only launcher: clones a real inventory count into the Sandbox
 * location, then navigates to the cloned count.
 */
export function CloneToSandboxButton({
  sourceLocationId,
  sourceCountId,
}: {
  sourceLocationId: string;
  sourceCountId: string;
}) {
  const { isSuperAdmin } = useUserRole();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const clone = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("clone_count_to_sandbox", {
        _source_location_id: sourceLocationId,
        _source_count_id: sourceCountId,
      });
      if (error) throw error;
      return data as string;
    },
    onMutate: () => setLoading(true),
    onSettled: () => setLoading(false),
    onSuccess: async (newCountId) => {
      // Look up sandbox location id so we can navigate
      const { data: sandbox } = await supabase
        .from("locations")
        .select("id")
        .eq("name", "Sandbox")
        .eq("requires_super_admin", true)
        .maybeSingle();
      if (!sandbox) {
        toast.error("Sandbox location not found");
        return;
      }
      toast.success("Cloned to sandbox");
      navigate(`/inventory/${sandbox.id}/count/${newCountId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isSuperAdmin) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => clone.mutate()}
      disabled={loading}
      title="Clone this count into the isolated super-admin sandbox"
    >
      <Beaker className="h-4 w-4 mr-2" />
      {loading ? "Cloning…" : "Clone to Sandbox"}
    </Button>
  );
}
