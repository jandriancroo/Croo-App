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
      const { data, error } = await supabase
        .from("location_stations" as any)
        .select("*")
        .eq("location_id", locationId!)
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
