import { format, addDays } from "date-fns";

interface PrintShift {
  userId: string;
  dayIndex: number; // 0-6 (Mon-Sun)
  startTime: string;
  endTime: string;
  isTimeOff: boolean;
  templateName?: string;
  templateColor?: string;
}

interface PrintProfile {
  id: string;
  fullName: string;
  role?: string;
}

export interface SchedulePrintData {
  locationName: string;
  weekStart: Date;
  profiles: PrintProfile[];
  shifts: PrintShift[];
  events?: { dayIndex: number; name: string; time: string }[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime12(time24: string): string {
  if (!time24) return "";
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? " PM" : " AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

export function exportScheduleToPrint(data: SchedulePrintData) {
  const weekEnd = addDays(data.weekStart, 6);
  const weekLabel = `${format(data.weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`;
  const dayHeaders = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(data.weekStart, i);
    return { short: format(d, "EEE"), date: format(d, "M/d") };
  });

  // Build rows
  const rows = data.profiles.map((profile) => {
    const userShifts = data.shifts.filter((s) => s.userId === profile.id);
    let totalHrs = 0;
    const cells = Array.from({ length: 7 }, (_, dayIdx) => {
      const dayShifts = userShifts.filter((s) => s.dayIndex === dayIdx);
      if (dayShifts.length === 0) return { html: "", hours: 0 };

      const parts = dayShifts.map((s) => {
        if (s.isTimeOff) return `<div class="shift-card off-card">OFF</div>`;
        const hrs = calcHours(s.startTime, s.endTime);
        totalHrs += hrs;
        const colorBar = s.templateColor || '#3b82f6';
        const templateLabel = s.templateName ? `<span class="pos-badge" style="border-color:${colorBar};color:${colorBar}">${escapeHtml(s.templateName)}</span>` : "";
        return `<div class="shift-card"><div class="card-edge" style="background:${colorBar}"></div><div class="card-body"><div class="card-time">${formatTime12(s.startTime)} - ${formatTime12(s.endTime)}</div>${templateLabel}</div></div>`;
      });

      return { html: parts.join(""), hours: 0 };
    });

    // Recalculate total from all non-time-off shifts
    totalHrs = userShifts
      .filter((s) => !s.isTimeOff)
      .reduce((sum, s) => sum + calcHours(s.startTime, s.endTime), 0);

    return { name: profile.fullName, role: profile.role, cells, totalHrs };
  });

  // Events row
  let eventsRowHtml = "";
  if (data.events && data.events.length > 0) {
    const eventCells = Array.from({ length: 7 }, (_, dayIdx) => {
      const dayEvents = data.events!.filter((e) => e.dayIndex === dayIdx);
      if (dayEvents.length === 0) return `<td class="cell event-cell"></td>`;
      const inner = dayEvents.map((e) => `<div class="event">${formatTime12(e.time)} ${escapeHtml(e.name)}</div>`).join("");
      return `<td class="cell event-cell">${inner}</td>`;
    }).join("");
    eventsRowHtml = `<tr><td class="name-cell event-label">Events</td>${eventCells}<td class="total-cell"></td></tr>`;
  }

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Schedule – ${escapeHtml(data.locationName)} – ${weekLabel}</title>
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
  .header .week { font-size: 14px; color: #555; font-weight: 500; }
  .header .location { font-size: 12px; color: #888; }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }
  th {
    background: #e8e8e8;
    border: 1px solid #d1d5db;
    padding: 8px 4px;
    text-align: center;
    font-weight: 700;
    font-size: 11px;
  }
  th .day-name { font-size: 12px; }
  th .day-date { font-size: 10px; color: #666; font-weight: 400; }
  th.name-th { text-align: left; padding-left: 8px; width: 130px; }
  th.total-th { width: 50px; }
  .name-cell {
    border: 1px solid #d1d5db;
    padding: 6px 8px;
    font-weight: 700;
    font-size: 11px;
    background: #fafafa;
    vertical-align: middle;
  }
  .name-cell .role-tag {
    font-size: 9px;
    font-weight: 400;
    color: #888;
    display: block;
    text-transform: capitalize;
  }
  .cell {
    border: 1px solid #d1d5db;
    padding: 3px;
    text-align: center;
    vertical-align: middle;
    background: white;
  }
  .total-cell {
    border: 1px solid #d1d5db;
    padding: 4px;
    text-align: center;
    font-weight: 700;
    font-size: 11px;
    background: #f9fafb;
    vertical-align: middle;
  }
  /* Card-style shifts */
  .shift-card {
    display: flex;
    align-items: stretch;
    background: #fafafa;
    border-radius: 6px;
    overflow: hidden;
    margin: 2px 0;
    border: 1px solid #e5e7eb;
  }
  .card-edge {
    width: 3px;
    flex-shrink: 0;
  }
  .card-body {
    padding: 3px 5px;
    text-align: left;
    min-width: 0;
  }
  .card-time {
    font-size: 9px;
    font-weight: 600;
    color: #1a1a1a;
    white-space: normal;
    word-wrap: break-word;
  }
  .pos-badge {
    display: inline-block;
    font-size: 8px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 8px;
    border: 1px solid;
    margin-top: 2px;
    text-transform: capitalize;
  }
  .off-card {
    justify-content: center;
    align-items: center;
    color: #9ca3af;
    font-style: italic;
    font-size: 10px;
    padding: 4px;
    background: #f9fafb;
  }
  .event-label {
    font-style: italic;
    color: #6b7280;
    font-weight: 500;
    background: #fffbeb;
  }
  .event-cell {
    background: #fffbeb;
    font-size: 9px;
    color: #92400e;
  }
  .event { white-space: nowrap; padding: 1px 0; }
  .footer {
    margin-top: 20px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    font-size: 9px;
    color: #aaa;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .powered-by {
    font-size: 10px;
    font-weight: 600;
    color: #999;
    letter-spacing: 0.5px;
  }
  @media print {
    body { padding: 0; background: white; }
    @page { 
      size: landscape;
      margin: 0.5in; 
    }
  }
</style>
</head><body>
<div class="header">
  <div>
    <h1>Weekly Schedule</h1>
    <div class="location">${escapeHtml(data.locationName)}</div>
  </div>
  <div class="week">${weekLabel}</div>
</div>

<table>
  <thead>
    <tr>
      <th class="name-th">Employee</th>
      ${dayHeaders.map((d) => `<th><div class="day-name">${d.short}</div><div class="day-date">${d.date}</div></th>`).join("")}
      <th class="total-th">Hrs</th>
    </tr>
  </thead>
  <tbody>
    ${eventsRowHtml}
    ${rows
      .map(
        (row) => `<tr>
      <td class="name-cell">${escapeHtml(row.name)}${row.role && row.role !== "team_member" ? `<span class="role-tag">${row.role.replace(/_/g, " ")}</span>` : ""}</td>
      ${row.cells.map((c) => `<td class="cell">${c.html}</td>`).join("")}
      <td class="total-cell">${row.totalHrs > 0 ? row.totalHrs.toFixed(1) : ""}</td>
    </tr>`
      )
      .join("")}
  </tbody>
</table>

<div class="footer">
  <span>Printed ${format(new Date(), "MMM d, yyyy 'at' h:mm a")} · Total staff: ${data.profiles.length}</span>
  <span class="powered-by">Powered by Croo</span>
</div>
</body></html>`;

  // Toolbar (hides on print)
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

  const finalHtml = html.replace(/<body>/, "<body>" + toolbarHtml);

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow pop-ups to print schedule");
    return;
  }
  printWindow.document.write(finalHtml);
  printWindow.document.close();
}
