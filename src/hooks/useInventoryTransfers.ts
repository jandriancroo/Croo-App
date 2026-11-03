import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatInTimeZone } from "date-fns-tz";
import { transferLinesTotal } from "@/lib/transferValue";

const DEFAULT_TRANSFER_TIMEZONE = "America/Los_Angeles";

/** Today's date (yyyy-MM-dd) in the sending location's timezone. */
async function getLocationLocalDate(locationId: string): Promise<string> {
  let tz = DEFAULT_TRANSFER_TIMEZONE;
  try {
    const { data } = await supabase
      .from("location_settings")
      .select("timezone")
      .eq("location_id", locationId)
      .maybeSingle();
    if (data?.timezone) tz = data.timezone;
  } catch {
    // fall back to default timezone
  }
  try {
    return formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  } catch {
    return formatInTimeZone(new Date(), DEFAULT_TRANSFER_TIMEZONE, "yyyy-MM-dd");
  }
}

export interface TransferItem {
  item_id: string;
  quantity: number;
  unit_type: "unit" | "case";
  cost_per_unit: number | null;
  item_name?: string;
}

export interface Transfer {
  id: string;
  from_location_id: string;
  to_location_id: string;
  transferred_by: string;
  transfer_date: string;
  period_end_date: string | null;
  status: string;
  received_by: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
  items?: any[];
  from_location?: { name: string };
  to_location?: { name: string };
  transferred_by_profile?: { full_name: string };
}

export const useInventoryTransfers = (locationId: string | undefined) => {
  const queryClient = useQueryClient();

  // Get all transfers involving this location
  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ["inventory-transfers", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_transfers")
        .select(`
          *,
          inventory_transfer_items (*)
        `)
        .or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch location names and profile names
      if (!data || data.length === 0) return [];

      const locationIds = [...new Set(data.flatMap(t => [t.from_location_id, t.to_location_id]))];
      const profileIds = [...new Set(data.map(t => t.transferred_by).filter(Boolean))];
      const itemIds = [...new Set(data.flatMap(t => (t.inventory_transfer_items || []).map((i: any) => i.item_id)))];

      const [locResult, profileResult, itemResult] = await Promise.all([
        supabase.from("locations").select("id, name").in("id", locationIds),
        supabase.from("profiles").select("id, full_name").in("id", profileIds),
        itemIds.length > 0
          ? supabase.from("inventory_items").select("id, name, pack_quantity").in("id", itemIds)
          : { data: [] },
      ]);

      const locMap = new Map((locResult.data || []).map(l => [l.id, l.name]));
      const profileMap = new Map((profileResult.data || []).map(p => [p.id, p.full_name]));
      const itemMap = new Map(((itemResult as any).data || []).map((i: any) => [i.id, i.name]));
      const packMap = new Map(((itemResult as any).data || []).map((i: any) => [i.id, i.pack_quantity]));

      return data.map(t => ({
        ...t,
        inventory_transfer_items: (t.inventory_transfer_items || []).map((ti: any) => ({
          ...ti,
          item_name: itemMap.get(ti.item_id) || "Unknown Item",
          pack_quantity: packMap.get(ti.item_id) ?? null,
        })),
        from_location: { name: locMap.get(t.from_location_id) || "Unknown" },
        to_location: { name: locMap.get(t.to_location_id) || "Unknown" },
        transferred_by_profile: { full_name: profileMap.get(t.transferred_by) || "Unknown" },
      }));
    },
    enabled: !!locationId,
  });

  // Count pending incoming transfers
  const pendingIncoming = transfers.filter(
    t => t.to_location_id === locationId && t.status === "pending"
  );

  // Send a transfer
  const sendTransfer = useMutation({
    mutationFn: async ({
      toLocationId,
      items,
      notes,
      periodEndDate,
      userId,
    }: {
      toLocationId: string;
      items: TransferItem[];
      notes?: string;
      periodEndDate?: string;
      userId: string;
    }) => {
      const transferDate = await getLocationLocalDate(locationId!);

      // Create transfer record
      const { data: transfer, error: transferErr } = await supabase
        .from("inventory_transfers")
        .insert({
          from_location_id: locationId!,
          to_location_id: toLocationId,
          transferred_by: userId,
          transfer_date: transferDate,
          period_end_date: periodEndDate || null,
          notes: notes || null,
          status: "pending",
        })
        .select()
        .single();

      if (transferErr) throw transferErr;

      // Insert transfer items
      const itemRows = items.map(item => ({
        transfer_id: transfer.id,
        item_id: item.item_id,
        quantity: item.quantity,
        unit_type: item.unit_type,
        cost_per_unit: item.cost_per_unit,
      }));

      const { error: itemsErr } = await supabase
        .from("inventory_transfer_items")
        .insert(itemRows);

      if (itemsErr) throw itemsErr;

      return transfer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-transfers", locationId] });
      toast.success("Transfer sent successfully");
    },
    onError: (err: any) => {
      console.error("Transfer failed:", err);
      toast.error("Failed to send transfer");
    },
  });

  // Receive/confirm a transfer
  const receiveTransfer = useMutation({
    mutationFn: async ({ transferId, userId }: { transferId: string; userId: string }) => {
      const { error } = await supabase
        .from("inventory_transfers")
        .update({
          status: "received",
          received_by: userId,
          received_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", transferId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-transfers", locationId] });
      toast.success("Transfer received");
    },
    onError: () => {
      toast.error("Failed to confirm transfer");
    },
  });

  // Cancel a transfer
  const cancelTransfer = useMutation({
    mutationFn: async (transferId: string) => {
      const { error } = await supabase
        .from("inventory_transfers")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", transferId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-transfers", locationId] });
      toast.success("Transfer cancelled");
    },
  });

  return {
    transfers,
    isLoading,
    pendingIncoming,
    sendTransfer,
    receiveTransfer,
    cancelTransfer,
  };
};

/**
 * Calculate transfer values for a specific period at a location.
 * Returns { transfersIn, transfersOut } as dollar totals.
 */
export function getTransferTotalsForPeriod(
  transfers: Transfer[],
  locationId: string,
  periodStart: string,
  periodEnd: string
): { transfersIn: number; transfersOut: number; transfersInItems: Transfer[]; transfersOutItems: Transfer[] } {
  const inRange = (dateStr: string) => dateStr >= periodStart && dateStr <= periodEnd;

  const transfersOutItems = transfers.filter(
    t => t.from_location_id === locationId && t.status === "received" && inRange(t.transfer_date)
  );
  const transfersInItems = transfers.filter(
    t => t.to_location_id === locationId && t.status === "received" && inRange(t.transfer_date)
  );

  const sumValue = (list: Transfer[]) =>
    list.reduce((total, t) => {
      const items = (t as any).inventory_transfer_items || t.items || [];
      return total + transferLinesTotal(items as any[]);
    }, 0);

  return {
    transfersIn: sumValue(transfersInItems),
    transfersOut: sumValue(transfersOutItems),
    transfersInItems,
    transfersOutItems,
  };
}
