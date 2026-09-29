import { DateTime } from 'luxon';

export interface DayInterview {
  id: string;
  full_name: string | null;
  interview_date: string;
  interview_time: string;
  interview_modality?: string | null;
  interview_meeting_url?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  timezone: string;
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: DateTime) => d.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
  out.push(rest);
  return out.join('\r\n');
};

/** One calendar file with every interview of the day. Same event IDs as the staff email links, so nothing doubles. */
export function buildDayIcs(items: DayInterview[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CrooHQ//Interview//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const seq = Math.floor(Date.now() / 1000);
  for (const i of items) {
    const start = DateTime.fromFormat(`${i.interview_date} ${String(i.interview_time).slice(0, 5)}`, 'yyyy-MM-dd HH:mm', { zone: i.timezone });
    if (!start.isValid) continue;
    const name = i.full_name || 'Applicant';
    const place = [i.locationName, i.locationAddress].filter(Boolean).join(', ');
    const m = i.interview_modality || 'in_person';
    let location = place;
    let description = `In-person interview with ${name} at ${place || 'the store'}.`;
    if (m === 'virtual' && i.interview_meeting_url) {
      location = i.interview_meeting_url;
      description = `Virtual interview with ${name}.\nJoin the call: ${i.interview_meeting_url}`;
    } else if (m === 'phone') {
      location = 'Phone call';
      description = `Phone interview. Call ${name}.`;
    }
    const summary = `Interview: ${name}${m === 'virtual' ? ' (virtual)' : m === 'phone' ? ' (phone)' : ''}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:interview-${i.id}-staff@croohq.com`,
      `SEQUENCE:${seq}`,
      `DTSTAMP:${stamp(DateTime.utc())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(start.plus({ minutes: 30 }))}`,
      `SUMMARY:${esc(summary)}`,
      ...(location ? [`LOCATION:${esc(location)}`] : []),
      `DESCRIPTION:${esc(description)}`,
      ...(m === 'virtual' && i.interview_meeting_url ? [`URL:${i.interview_meeting_url}`] : []),
      'STATUS:CONFIRMED',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
