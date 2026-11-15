// Retired week seeder. Only shared date/timezone helpers remain.

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function todayInTimezone(tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Monday-anchored week start for a yyyy-MM-dd business date.
export function weekStartFor(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  return addDaysStr(dateStr, -diff);
}

export async function getLocationTimezone(supabase: any, locationId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("location_settings")
      .select("timezone")
      .eq("location_id", locationId)
      .maybeSingle();
    return (data?.timezone as string) || "America/Los_Angeles";
  } catch {
    return "America/Los_Angeles";
  }
}

