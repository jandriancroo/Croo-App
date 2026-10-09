// Shared 24-hour hourly_data builder (moved unchanged from sales-service).
// Keeps projected / laborPercent / laborCost from the existing cache row.

export function formatHourlyTo24(
  hourlyData: { hour: string; sales: number; checksCount: number }[],
  existingHourly?: any[]
): any[] {
  // Build lookup of existing projected/laborPercent/laborCost values
  const existingMap = new Map<string, any>();
  if (existingHourly) {
    for (const h of existingHourly) {
      if (h?.hour) existingMap.set(h.hour, h);
    }
  }
  
  const formatted = [];
  for (let h = 0; h < 24; h++) {
    const hourStr = `${h.toString().padStart(2, '0')}:00`;
    const hourData = hourlyData.find(hd => hd.hour === hourStr);
    const existing = existingMap.get(hourStr);
    const entry: any = {
      hour: hourStr,
      sales: hourData?.sales || 0,
      checksCount: hourData?.checksCount || 0
    };
    // Preserve projected values from existing cache (set by fetch-qubeyond-sales)
    if (existing?.projected != null && existing.projected > 0) {
      entry.projected = existing.projected;
    }
    if (existing?.laborPercent != null) {
      entry.laborPercent = existing.laborPercent;
    }
    if (existing?.laborCost != null) {
      entry.laborCost = existing.laborCost;
    }
    formatted.push(entry);
  }
  return formatted;
}
