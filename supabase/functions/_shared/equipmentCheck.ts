// Copy for the equipment-check alert (same unit failed its temp check on two
// separate days within two days). One source for the push, the email and the
// in-app badge. Values come from the equipment_check_alerts row only.
import { asEquipmentType, safeRangeText, TEMP_BANDS, type EquipmentType } from './tempBands.ts';

export interface EquipmentReading { temp: number; at: string }
export interface EquipmentAlertRow {
  unit_name: string;
  location_name: string;
  equipment_type: string | null;
  timezone: string | null;
  readings: EquipmentReading[] | unknown;
}

export const fmtTemp = (t: number) => `${Number.isInteger(t) ? t : Number(t.toFixed(1))}°F`;

/** "Mon Nov 16, 2:10 PM" in the store's time zone. */
export function fmtReadingTime(iso: string, timeZone: string | null | undefined): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = timeZone || 'America/Los_Angeles';
  try {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(d).replace(',', '');
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(d);
    return `${day}, ${time}`;
  } catch {
    return d.toISOString();
  }
}

export function readingsOf(row: Pick<EquipmentAlertRow, 'readings'>): EquipmentReading[] {
  const list = Array.isArray(row.readings) ? row.readings : [];
  return list
    .filter((r: any) => r && Number.isFinite(Number(r.temp)) && typeof r.at === 'string')
    .map((r: any) => ({ temp: Number(r.temp), at: r.at }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function equipmentTip(tag: EquipmentType | null): string {
  return tag ? TEMP_BANDS[tag].tip : 'Check the unit and re-check the temperature in 1 hour. Call for service if it stays out of range.';
}

export function equipmentAlertCopy(row: EquipmentAlertRow) {
  const tag = asEquipmentType(row.equipment_type);
  const unit = String(row.unit_name ?? '').replace(/\s+/g, ' ').trim();
  const store = String(row.location_name ?? '').replace(/\s+/g, ' ').trim();
  const readings = readingsOf(row);
  const latest = readings[readings.length - 1];
  const band = tag ? TEMP_BANDS[tag] : null;
  const rangeLabel = band ? `Safe range for ${band.plural}: ${safeRangeText(tag)}` : `Safe range: ${safeRangeText(tag)}`;
  const readingText = readings.map(r => `${fmtTemp(r.temp)} on ${fmtReadingTime(r.at, row.timezone)}`).join(' and ');
  return {
    title: 'Please check equipment',
    subject: `Please check equipment: ${unit}, ${store}`,
    pushBody: `${unit} at ${store} failed temp checks 2 days in a row${latest ? ` (${fmtTemp(latest.temp)})` : ''}.`,
    paragraph: `${unit} at ${store} failed its temp check on 2 separate days: ${readingText}. ${rangeLabel}. ${equipmentTip(tag)} Re-check in 1 hour.`,
    rangeLabel,
    tip: equipmentTip(tag),
    readings,
    unit,
    store,
  };
}
