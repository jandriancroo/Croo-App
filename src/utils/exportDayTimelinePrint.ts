import { format } from 'date-fns';
import { ShiftBreak, normalizeBreaks } from '@/types/shiftBreak';
import { formatTime12 } from '@/utils/breakCoverage';

interface PrintProfile {
  id: string;
  full_name: string;
  role?: string | null;
}

interface PrintShift {
  id: string;
  user_id: string | null;
  start_time: string;
  end_time: string;
  template_name?: string | null;
  template_color?: string | null;
  position?: string | null;
  breaks?: unknown;
}

export interface PrintStation {
  id: string;
  name: string;
  color?: string;
}

export interface DayTimelinePrintData {
  locationName: string;
  date: Date;
  profiles: PrintProfile[];
  shifts: PrintShift[];
  /** Whether the location uses break coverage; controls page 2 detail. */
  breakCoverageEnabled?: boolean;
  /** Optional stations to group by. When provided, output is grouped per station. */
  stations?: PrintStation[];
  /** Map of user_id -> station_id (or null for unassigned). */
  stationAssignments?: Record<string, string | null>;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function computeWindow(shifts: PrintShift[]): { startHour: number; endHour: number } {
  let min = 9 * 60;
  let max = 18 * 60;
  for (const s of shifts) {
    if (!s.start_time || !s.end_time) continue;
    let start = toMinutes(s.start_time);
    let end = toMinutes(s.end_time);
    if (end <= start) end += 24 * 60;
    if (start < min) min = start;
    if (end > max) max = end;
  }
  const startHour = Math.max(0, Math.floor(min / 60) - 1);
  const endHour = Math.min(28, Math.ceil(max / 60) + 1);
  return { startHour, endHour };
}

export function exportDayTimelineToPrint(data: DayTimelinePrintData) {
  const dateLabel = format(data.date, 'EEEE, MMMM d, yyyy');

  // Group shifts by user
  const shiftsByUser = new Map<string, PrintShift[]>();
  for (const s of data.shifts) {
    if (!s.user_id) continue;
    const list = shiftsByUser.get(s.user_id) || [];
    list.push(s);
    shiftsByUser.set(s.user_id, list);
  }

  // Coverers list per user (for "Covering" section page 2)
  const coveringByUser = new Map<
    string,
    Array<{ coveredUserName: string; start: string; end: string }>
  >();
  for (const s of data.shifts) {
    const breaks = normalizeBreaks(s.breaks);
    if (!breaks.length) continue;
    const coveredProfile = data.profiles.find((p) => p.id === s.user_id);
    for (const b of breaks) {
      if (!b.covered_by_user_id) continue;
      const list = coveringByUser.get(b.covered_by_user_id) || [];
      list.push({
        coveredUserName: coveredProfile?.full_name || 'Unknown',
        start: b.start_time,
        end: b.end_time,
      });
      coveringByUser.set(b.covered_by_user_id, list);
    }
  }

  const { startHour, endHour } = computeWindow(data.shifts);
  const totalMinutes = (endHour - startHour) * 60;

  const profilesWithShifts = data.profiles.filter(
    (p) => shiftsByUser.has(p.id) || coveringByUser.has(p.id),
  );

  // Page 1 — visual timeline (landscape)
  const hourHeaders = Array.from({ length: endHour - startHour }, (_, i) => {
    const h = startHour + i;
    const display = h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`;
    return display;
  });

  function pctFor(time: string): number {
    let mins = toMinutes(time) - startHour * 60;
    if (mins < 0) mins += 24 * 60;
    return Math.max(0, Math.min(100, (mins / totalMinutes) * 100));
  }

  const timelineRows = profilesWithShifts
    .map((p) => {
      const userShifts = shiftsByUser.get(p.id) || [];
      const coveringBlocks = coveringByUser.get(p.id) || [];

      const shiftBars = userShifts
        .map((s) => {
          if (!s.start_time || !s.end_time) return '';
          const left = pctFor(s.start_time);
          let right = pctFor(s.end_time);
          if (right <= left) right = 100;
          const width = right - left;
          const color = s.template_color || '#3b82f6';
          const breaks = normalizeBreaks(s.breaks);
          const breakHtml = breaks
            .map((b) => {
              const bLeft = pctFor(b.start_time);
              let bRight = pctFor(b.end_time);
              if (bRight <= bLeft) bRight = bLeft + 1;
              const bWidth = bRight - bLeft;
              const tooltip = `Break ${formatTime12(b.start_time)}–${formatTime12(b.end_time)}`;
              return `<div class="break-overlay" style="left:${bLeft}%;width:${bWidth}%" title="${escapeHtml(tooltip)}"></div>`;
            })
            .join('');
          const rawLabel = s.position || s.template_name || '';
          // Strip trailing time range (e.g. "Teacher 7:00 AM - 4:00 PM" → "Teacher")
          const label = rawLabel.replace(/\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*[-–—]\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i, '').trim();
          return `
            <div class="shift-bar" style="left:${left}%;width:${width}%;background:${color}22;border-color:${color}">
              <span class="shift-time" style="color:${color}">${formatTime12(s.start_time)}–${formatTime12(s.end_time)}</span>
              ${label ? `<span class="shift-label">${escapeHtml(label)}</span>` : ''}
              ${breakHtml}
            </div>`;
        })
        .join('');

      const coveringBars = coveringBlocks
        .map((c) => {
          const left = pctFor(c.start);
          let right = pctFor(c.end);
          if (right <= left) right = left + 1;
          const width = right - left;
          return `<div class="covering-bar" style="left:${left}%;width:${width}%" title="Covering ${escapeHtml(c.coveredUserName)} ${formatTime12(c.start)}–${formatTime12(c.end)}">Covering ${escapeHtml(c.coveredUserName)}</div>`;
        })
        .join('');

      return `
        <tr>
          <td class="name-cell">${escapeHtml(p.full_name)}${p.role && p.role !== 'team_member' ? `<span class="role-tag">${escapeHtml(p.role.replace(/_/g, ' '))}</span>` : ''}</td>
          <td class="timeline-cell">
            <div class="timeline-track">
              ${hourHeaders.map((_, i) => `<div class="hour-grid" style="left:${(i / hourHeaders.length) * 100}%"></div>`).join('')}
              ${shiftBars}
              ${coveringBars}
            </div>
          </td>
        </tr>`;
    })
    .join('');

  // Page 2 — roster + coverage list (portrait)
  const rosterItems = profilesWithShifts
    .map((p) => {
      const userShifts = shiftsByUser.get(p.id) || [];
      const coveringBlocks = coveringByUser.get(p.id) || [];

      const shiftItems = userShifts
        .map((s) => {
          const breaks = normalizeBreaks(s.breaks);
          const breakItems = breaks
            .map((b) => {
              return `<div class="break-line">☕ Break ${formatTime12(b.start_time)}–${formatTime12(b.end_time)}</div>`;
            })
            .join('');
          const rawLabel = s.position || s.template_name || '';
          const label = rawLabel.replace(/\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*[-–—]\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i, '').trim();
          return `
            <div class="shift-entry">
              <div class="shift-line">
                <strong>${formatTime12(s.start_time)}–${formatTime12(s.end_time)}</strong>
                ${label ? ` · ${escapeHtml(label)}` : ''}
              </div>
              ${breakItems}
            </div>`;
        })
        .join('');

      const coveringHtml =
        coveringBlocks.length > 0
          ? `<div class="covering-section">
              <div class="covering-header">Covering</div>
              ${coveringBlocks
                .map(
                  (c) =>
                    `<div class="covering-line">↳ ${escapeHtml(c.coveredUserName)} · ${formatTime12(c.start)}–${formatTime12(c.end)}</div>`,
                )
                .join('')}
            </div>`
          : '';

      return `
        <div class="roster-item">
          <div class="roster-name">${escapeHtml(p.full_name)}${p.role && p.role !== 'team_member' ? `<span class="role-tag-2">${escapeHtml(p.role.replace(/_/g, ' '))}</span>` : ''}</div>
          ${shiftItems || '<div class="no-shift">(no shift)</div>'}
          ${coveringHtml}
        </div>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Day Timeline – ${escapeHtml(data.locationName)} – ${dateLabel}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a1a;
    background: #f5f5f5;
    padding: 24px;
    font-size: 11px;
    line-height: 1.4;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 3px solid #1a1a1a;
    padding-bottom: 10px;
    margin-bottom: 16px;
  }
  .header h1 { font-size: 18px; font-weight: 700; }
  .header .date { font-size: 14px; color: #555; font-weight: 500; }
  .header .location { font-size: 12px; color: #888; }

  /* Page 1 — visual timeline */
  table.timeline {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }
  table.timeline th, table.timeline td {
    border: 1px solid #d1d5db;
    vertical-align: middle;
  }
  table.timeline th {
    background: #e8e8e8;
    font-weight: 700;
    padding: 4px;
    font-size: 10px;
  }
  th.name-th { width: 130px; text-align: left; padding-left: 8px; }
  .hours-th { padding: 0 !important; }
  .hours-row {
    display: flex;
    width: 100%;
    height: 16px;
  }
  .hours-row-cell {
    flex: 1 1 0;
    min-width: 0;
    text-align: center;
    font-size: 9px;
    color: #555;
    border-left: 1px dashed #ccc;
    line-height: 16px;
  }
  .hours-row-cell:first-child { border-left: 0; }

  .name-cell {
    padding: 6px 8px;
    font-weight: 700;
    font-size: 11px;
    background: #fafafa;
  }
  .name-cell .role-tag {
    font-size: 9px;
    font-weight: 400;
    color: #888;
    display: block;
    text-transform: capitalize;
  }
  .timeline-cell { padding: 4px; background: white; }
  .timeline-track {
    position: relative;
    height: 44px;
    background:
      repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(100% / 24 - 1px),
        #eee calc(100% / 24 - 1px),
        #eee calc(100% / 24)
      );
  }
  .hour-grid {
    position: absolute;
    top: 0; bottom: 0;
    width: 1px;
    background: #f0f0f0;
  }
  .shift-bar {
    position: absolute;
    top: 4px; bottom: 4px;
    border: 1px solid;
    border-radius: 4px;
    padding: 2px 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .shift-time { font-size: 9px; font-weight: 700; white-space: nowrap; }
  .shift-label { font-size: 8px; color: #555; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
  .break-overlay {
    position: absolute;
    top: 0; bottom: 0;
    background: repeating-linear-gradient(
      45deg,
      rgba(245, 158, 11, 0.45),
      rgba(245, 158, 11, 0.45) 4px,
      rgba(245, 158, 11, 0.25) 4px,
      rgba(245, 158, 11, 0.25) 8px
    );
    border-left: 1px solid rgba(180, 83, 9, 0.6);
    border-right: 1px solid rgba(180, 83, 9, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .break-label { font-size: 8px; font-weight: 700; color: #92400e; white-space: nowrap; }
  .covering-bar {
    position: absolute;
    top: 4px; bottom: 4px;
    background: rgba(99, 102, 241, 0.18);
    border: 1px dashed rgba(99, 102, 241, 0.55);
    border-radius: 4px;
    padding: 0 6px;
    font-size: 9px;
    color: #4338ca;
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
  }

  /* Page 2 — roster */
  .page-break { page-break-before: always; }
  .roster-grid {
    columns: 2;
    column-gap: 18px;
  }
  .roster-item {
    break-inside: avoid;
    padding: 8px 10px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    margin-bottom: 8px;
    background: white;
  }
  .roster-name {
    font-weight: 700;
    font-size: 12px;
    margin-bottom: 4px;
    border-bottom: 1px solid #eee;
    padding-bottom: 3px;
  }
  .role-tag-2 {
    font-size: 9px;
    font-weight: 400;
    color: #888;
    text-transform: capitalize;
    margin-left: 6px;
  }
  .shift-entry { margin: 4px 0; }
  .shift-line { font-size: 11px; }
  .break-line { font-size: 10px; color: #92400e; margin-left: 10px; padding: 1px 0; }
  .no-shift { font-size: 10px; color: #aaa; font-style: italic; }
  .covering-section { margin-top: 6px; padding-top: 4px; border-top: 1px dashed #ddd; }
  .covering-header { font-size: 9px; font-weight: 700; color: #4338ca; text-transform: uppercase; letter-spacing: 0.4px; }
  .covering-line { font-size: 10px; color: #4338ca; margin-left: 6px; }

  .footer {
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    font-size: 9px;
    color: #aaa;
    display: flex;
    justify-content: space-between;
  }
  .powered-by { font-weight: 600; color: #999; letter-spacing: 0.5px; }

  @page :first { size: landscape; margin: 0.4in; }
  @page { size: portrait; margin: 0.5in; }

  @media print {
    body { padding: 0; background: white; }
  }
</style>
</head><body>

<!-- PAGE 1: visual timeline (landscape) -->
<div class="header">
  <div>
    <h1>Day Timeline</h1>
    <div class="location">${escapeHtml(data.locationName)}</div>
  </div>
  <div class="date">${dateLabel}</div>
</div>

<table class="timeline">
  <thead>
    <tr>
      <th class="name-th">Employee</th>
      <th class="hours-th">
        <div class="hours-row">
          ${hourHeaders.map((h) => `<div class="hours-row-cell">${h}</div>`).join('')}
        </div>
      </th>
    </tr>
  </thead>

  <tbody>
    ${timelineRows || '<tr><td class="name-cell">—</td><td class="timeline-cell"><em>No shifts</em></td></tr>'}
  </tbody>
</table>

<div class="footer">
  <span>Page 1 of 2 · Visual timeline</span>
  <span class="powered-by">Powered by Croo</span>
</div>

<!-- PAGE 2: roster + coverage (portrait) -->
<div class="page-break"></div>
<div class="header">
  <div>
    <h1>Roster &amp; Coverage</h1>
    <div class="location">${escapeHtml(data.locationName)}</div>
  </div>
  <div class="date">${dateLabel}</div>
</div>

<div class="roster-grid">
  ${rosterItems || '<div class="no-shift">No shifts scheduled.</div>'}
</div>

<div class="footer">
  <span>Printed ${format(new Date(), "MMM d, yyyy 'at' h:mm a")} · ${profilesWithShifts.length} staff</span>
  <span class="powered-by">Powered by Croo</span>
</div>

</body></html>`;

  // Toolbar overlay for the user
  const toolbarHtml = `
    <div id="pdf-toolbar" style="
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      background: #1a1a1a; color: white; padding: 10px 20px;
      display: flex; align-items: center; justify-content: space-between;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
    ">
      <span>To save as PDF: <strong>Share → Save as PDF</strong> (iOS) or <strong>⌘P → Save as PDF</strong> (Desktop)</span>
      <button onclick="document.getElementById('pdf-toolbar').style.display='none'; window.print();" style="
        background: #3b82f6; color: white; border: none; padding: 8px 20px;
        border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px;
      ">Print / Save PDF</button>
    </div>
    <style>
      @media print { #pdf-toolbar { display: none !important; } }
      body { padding-top: 56px !important; }
    </style>
  `;

  const finalHtml = html.replace(/<body>/, '<body>' + toolbarHtml);

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow pop-ups to print the day timeline');
    return;
  }
  printWindow.document.write(finalHtml);
  printWindow.document.close();
}
