import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LocationStation {
  id: string;
  location_id: string;
  name: string;
  color: string;
  sort_order: number;
  is_active: boolean;
}

const STATIONS_KEY = (locationId: string | null | undefined) => [
  "location_stations",
  locationId,
];

export function useLocationStations(locationId: string | null | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: STATIONS_KEY(locationId),
    enabled: !!locationId,
    queryFn: async (): Promise<LocationStation[]> => {
      if (!locationId) return [];
      const { data, error } = await supabase
        .from("location_stations" as any)
        .select("*")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LocationStation[];
    },
    staleTime: 60_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: STATIONS_KEY(locationId) });

  const create = useMutation({
    mutationFn: async (input: { name: string; color: string }) => {
      if (!locationId) throw new Error("No location");
      const nextSort = (query.data ?? []).length;
      const { data, error } = await supabase
        .from("location_stations" as any)
        .insert({
          location_id: locationId,
          name: input.name,
          color: input.color,
          sort_order: nextSort,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      color?: string;
      sort_order?: number;
    }) => {
      const { id, ...patch } = input;
      const { error } = await supabase
        .from("location_stations" as any)
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // Soft delete to preserve any historical shift tagging
      const { error } = await supabase
        .from("location_stations" as any)
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((id, idx) =>
          supabase
            .from("location_stations" as any)
            .update({ sort_order: idx })
            .eq("id", id)
        )
      );
    },
    onSuccess: invalidate,
  });

  return {
    stations: query.data ?? [],
    isLoading: query.isLoading,
    create,
    update,
    remove,
    reorder,
  };
}

/**
 * Station mode for schedule screens: the store's active stations, and whether station UI shows
 * (location_settings.stations_enabled AND at least one active station).
 */
export function useStationMode(locationId: string | null | undefined) {
  const qc = useQueryClient();
  const queryKey = ["location_stations_enabled", locationId];
  const query = useQuery({
    queryKey,
    enabled: !!locationId,
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from("location_settings")
        .select("stations_enabled")
        .eq("location_id", locationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!locationId) throw new Error("No location");
      const { error } = await supabase.from("location_settings").upsert(
        { location_id: locationId, stations_enabled: enabled }, { onConflict: "location_id" }
      );
      if (error) throw error;
      return enabled;
    },
    onSuccess: async (enabled) => {
      qc.setQueryData(queryKey, { stations_enabled: enabled });
      await qc.invalidateQueries({ queryKey });
    },
  });
  return { enabled: !!query.data?.stations_enabled, isLoading: query.isLoading, save };
}

export function useScheduleStations(locationId: string | null | undefined) {
  const { stations } = useLocationStations(locationId);
  const mode = useStationMode(locationId);
  return { stations, enabled: mode.enabled && stations.length > 0 };
}
