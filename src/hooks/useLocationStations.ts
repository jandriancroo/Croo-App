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
      const results = await Promise.all(
        orderedIds.map(async (id, idx) => {
          const { error } = await supabase
            .from("location_stations" as any)
            .update({ sort_order: idx })
            .eq("id", id);
          return error;
        })
      );
      const error = results.find(Boolean);
      if (error) throw error;
    },
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: STATIONS_KEY(locationId) });
      const previous = qc.getQueryData<LocationStation[]>(STATIONS_KEY(locationId));
      if (previous) {
        const byId = new Map(previous.map(station => [station.id, station]));
        qc.setQueryData(STATIONS_KEY(locationId), orderedIds.flatMap((id, sort_order) => {
          const station = byId.get(id);
          return station ? [{ ...station, sort_order }] : [];
        }));
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) qc.setQueryData(STATIONS_KEY(locationId), context.previous);
    },
    onSettled: invalidate,
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
      await Promise.all([
        qc.invalidateQueries({ queryKey }),
        qc.invalidateQueries({ queryKey: ["mobile-schedule-stations-enabled", locationId] }),
        qc.invalidateQueries({ queryKey: ["schedule-stations-enabled", locationId] }),
      ]);
    },
  });
  return { enabled: !!query.data?.stations_enabled, isLoading: query.isLoading, save };
}

export function useScheduleStations(locationId: string | null | undefined) {
  const { stations } = useLocationStations(locationId);
  const mode = useStationMode(locationId);
  return { stations, enabled: mode.enabled && stations.length > 0 };
}
