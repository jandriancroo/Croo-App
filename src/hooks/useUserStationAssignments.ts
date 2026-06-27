import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Reads `user_locations.primary_station_id` for everyone at this location.
 * Returns a Map<user_id, station_id|null> plus a mutation to assign someone.
 */
export function useUserStationAssignments(locationId: string | null | undefined) {
  const qc = useQueryClient();
  const key = ["user_station_assignments", locationId];

  const query = useQuery({
    queryKey: key,
    enabled: !!locationId,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, string | null>> => {
      const { data, error } = await supabase
        .from("user_locations")
        .select("user_id, primary_station_id")
        .eq("location_id", locationId!);
      if (error) throw error;
      const out: Record<string, string | null> = {};
      for (const row of (data ?? []) as Array<{ user_id: string; primary_station_id: string | null }>) {
        out[row.user_id] = row.primary_station_id ?? null;
      }
      return out;
    },
  });

  const assign = useMutation({
    mutationFn: async (args: { userId: string; stationId: string | null }) => {
      if (!locationId) throw new Error("No location");
      const { error } = await supabase
        .from("user_locations")
        .update({ primary_station_id: args.stationId })
        .eq("location_id", locationId)
        .eq("user_id", args.userId);
      if (error) throw error;
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Record<string, string | null>>(key);
      qc.setQueryData<Record<string, string | null>>(key, {
        ...(prev ?? {}),
        [args.userId]: args.stationId,
      });
      return { prev };
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error("Couldn't update station");
    },
    onSuccess: () => {
      toast.success("Station updated");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  return {
    assignments: query.data ?? {},
    isLoading: query.isLoading,
    assign: (userId: string, stationId: string | null) =>
      assign.mutate({ userId, stationId }),
  };
}
