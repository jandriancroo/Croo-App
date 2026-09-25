// QU Beyond labor — used only for stores whose "Pull Qu Labor %" switch is ON.
// Writes go to labor_cache with source = 'qubeyond' on (location_id, labor_date, source),
// so time clock rows are never touched or overwritten. sales_cache is never written here.

export interface QuLabor {
  laborPercent: number;
  laborCost: number;
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
}

function v4Headers(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'x-integration': Deno.env.get('QU_INTEGRATION_USER_ID') || '',
  };
}

export async function fetchQuLabor(token: string, dateStr: string, qbLocationId: string): Promise<QuLabor | null> {
  try {
    const res = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/real-time-summary/sections/overview', {
      method: 'POST',
      headers: v4Headers(token),
      body: JSON.stringify({
        fields: [{ fieldName: 'metric' }, { fieldName: 'total' }],
        filters: {
          date: { from: null, to: null, values: [dateStr], type: 'today' },
          singleLocation: parseInt(qbLocationId),
          clockInRequired: true,
        },
        params: { sectionId: 'overview', pageNumber: 1, pageSize: 25, totalRecords: null, sort: null, showTotals: true },
      }),
    });
    if (!res.ok) {
      console.error(`[QU-LABOR] ${dateStr} fetch failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const out: QuLabor = { laborPercent: 0, laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0 };
    for (const item of (data?.items || [])) {
      const metric = String(item.metric || '').toLowerCase();
      const total = parseFloat(String(item.total ?? '0').replace(/[$,%]/g, '')) || 0;
      if (metric.includes('total labor %')) out.laborPercent = total;
      else if (metric.includes('labor cost')) out.laborCost = total;
      else if (metric === 'hours worked') out.hoursWorked = total;
      else if (metric === 'regular hours') out.regularHours = total;
      else if (metric === 'overtime hours') out.overtimeHours = total;
    }
    return out;
  } catch (e) {
    console.error('[QU-LABOR] fetch error', e);
    return null;
  }
}

/** Upsert a QU labor row. Skips empty results so a blip never saves $0. */
export async function saveQuLabor(supabase: any, locationId: string, dateStr: string, labor: QuLabor | null): Promise<boolean> {
  if (!labor || labor.laborCost <= 0) return false;
  const { error } = await supabase.from('labor_cache').upsert({
    location_id: locationId,
    labor_date: dateStr,
    labor_cost: labor.laborCost,
    labor_hours: labor.hoursWorked,
    regular_hours: labor.regularHours,
    overtime_hours: labor.overtimeHours,
    source: 'qubeyond',
    fetched_at: new Date().toISOString(),
  }, { onConflict: 'location_id,labor_date,source' });
  if (error) {
    console.error(`[QU-LABOR] save ${dateStr} failed: ${error.message}`);
    return false;
  }
  return true;
}
