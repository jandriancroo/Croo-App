type SyncMode = "live" | "yesterday" | "date";

interface ExistingSales {
  net_sales?: number | null;
  guest_count?: number | null;
  validation_status?: string | null;
}

/** Yesterday closes out live partials; manual re-pulls preserve finished sales. */
export function resolveAlohaCloseout(
  mode: SyncMode,
  incomingSales: number,
  incomingGuests: number,
  existing?: ExistingSales | null,
) {
  const keepVerifiedSales = mode !== "live" && existing?.validation_status === "valid";
  return {
    net_sales: keepVerifiedSales
      ? existing?.net_sales
      : mode === "date" && Number(existing?.net_sales) > 0
        ? existing?.net_sales
        : incomingSales > 0 ? incomingSales : (existing?.net_sales ?? 0),
    guest_count: mode === "date" && Number(existing?.guest_count) > 0
      ? existing?.guest_count
      : incomingGuests > 0 ? incomingGuests : (existing?.guest_count ?? 0),
  };
}