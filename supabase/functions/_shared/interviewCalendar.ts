// @ts-nocheck
// Shared interview calendar helpers (applicant + staff emails, interview-calendar function).
// - Store-local wall time -> UTC via the store's location_settings.timezone (Coop's Central, Blaze Pacific).
// - Stable UID per application so a rescheduled link updates the same calendar event.
// - Virtual: calendar files contain a signed CrooHQ join link, never the raw Meet URL.
import { DateTime } from "npm:luxon@3.4.4";

export const CAL_FUNCTION_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/interview-calendar`;

export async function signApplication(appId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! + ":interview-ics"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(appId));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export interface InterviewCal {
  applicationId: string;
  applicantName: string;
  orgName: string;
  locationName: string;
  locationAddress: string | null;
  timezone: string;
  date: string; // yyyy-MM-dd store local
  time: string; // HH:mm[:ss] store local
  modality: string;
  meetingUrl: string | null;
  status: string | null;
}

export async function loadInterview(supabase: any, appId: string): Promise<InterviewCal | null> {
  const { data: app } = await supabase
    .from("job_applications")
    .select("id, full_name, interview_date, interview_time, interview_status, interview_modality, interview_meeting_url, location_id, location:locations(name, address), organization:organizations(name, brand_name)")
    .eq("id", appId)
    .maybeSingle();
  if (!app || !app.interview_date || !app.interview_time) return null;
  let timezone = "America/Los_Angeles";
  if (app.location_id) {
    const { data: ls } = await supabase.from("location_settings").select("timezone").eq("location_id", app.location_id).maybeSingle();
    if (ls?.timezone) timezone = ls.timezone;
  }
  return {
    applicationId: app.id,
    applicantName: app.full_name || "Applicant",
    orgName: app.organization?.brand_name || app.organization?.name || "Hiring Team",
    locationName: app.location?.name || "",
    locationAddress: app.location?.address || null,
    timezone,
    date: app.interview_date,
    time: String(app.interview_time).slice(0, 5),
    modality: app.interview_modality || "in_person",
    meetingUrl: app.interview_meeting_url || null,
    status: app.interview_status,
  };
}

const utcStamp = (dt: DateTime) => dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
const icsEsc = (v: string) => String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = " " + rest.slice(74); }
  out.push(rest);
  return out.join("\r\n");
};

function times(i: InterviewCal) {
  const start = DateTime.fromFormat(`${i.date} ${i.time}`, "yyyy-MM-dd HH:mm", { zone: i.timezone });
  return { start, end: start.plus({ minutes: 30 }) };
}

function details(i: InterviewCal, audience: "applicant" | "staff", joinUrl?: string) {
  const place = [i.locationName, i.locationAddress].filter(Boolean).join(", ");
  const summary = audience === "staff"
    ? `Interview: ${i.applicantName}${i.modality === "virtual" ? " (virtual)" : i.modality === "phone" ? " (phone)" : ""}`
    : `${i.modality === "phone" ? "Phone interview" : i.modality === "virtual" ? "Virtual interview" : "Interview"} with ${i.orgName}`;
  let location = place;
  let description = "";
  if (i.modality === "virtual" && i.meetingUrl) {
    // Google rewrites raw Meet links anywhere in an imported event. Only expose CrooHQ here.
    location = "Virtual (link in notes)";
    description = `Virtual interview${audience === "staff" ? ` with ${i.applicantName}` : ""}.\nJoin the call (${audience === "staff" ? "opens the same room as the applicant" : "use this link"}): ${joinUrl || "Open CrooHQ for the call link"}`;
  } else if (i.modality === "phone") {
    location = "Phone call";
    description = audience === "staff" ? `Phone interview. Call ${i.applicantName}.` : "Phone interview. A manager will call you.";
  } else {
    description = `In-person interview${audience === "staff" ? ` with ${i.applicantName}` : ""} at ${place || i.orgName}.`;
  }
  return { summary, location, description };
}

export function buildIcs(i: InterviewCal, audience: "applicant" | "staff", joinUrl?: string): string {
  const { start, end } = times(i);
  const { summary, location, description } = details(i, audience, joinUrl);
  const cancelled = ["declined", "cancelled", "canceled"].includes(String(i.status));
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CrooHQ//Interview//EN", "CALSCALE:GREGORIAN",
    `METHOD:${cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:interview-${i.applicationId}-${audience}@croohq.com`,
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTAMP:${utcStamp(DateTime.utc())}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${icsEsc(summary)}`,
    location ? `LOCATION:${icsEsc(location)}` : "",
    `DESCRIPTION:${icsEsc(description)}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(summary)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(i: InterviewCal, audience: "applicant" | "staff", joinUrl?: string): string {
  const { start, end } = times(i);
  const { summary, location, description } = details(i, audience, joinUrl);
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: summary,
    dates: `${utcStamp(start)}/${utcStamp(end)}`,
    details: description,
    location,
    ctz: i.timezone,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export async function calendarFileUrl(appId: string, audience: "applicant" | "staff"): Promise<string> {
  return `${CAL_FUNCTION_URL}?a=${appId}&s=${await signApplication(appId)}&for=${audience}`;
}

export async function interviewJoinUrl(appId: string): Promise<string> {
  return `${CAL_FUNCTION_URL}?action=join&a=${appId}&s=${await signApplication(appId)}`;
}

/** Two email buttons: Google Calendar + Apple/Outlook (.ics). Returns "" if no interview found. */
export async function calendarButtonsHtml(i: InterviewCal | null, audience: "applicant" | "staff", primaryColor: string): Promise<string> {
  if (!i) return "";
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const joinUrl = await interviewJoinUrl(i.applicationId);
  const g = esc(googleCalendarUrl(i, audience, joinUrl));
  const f = esc(await calendarFileUrl(i.applicationId, audience));
  const btn = `display:inline-block;margin:4px;border:1.5px solid ${primaryColor};color:${primaryColor};text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600;font-size:14px;`;
  return `<div style="text-align:center;margin:18px 0 4px;"><p style="color:#888;font-size:12px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;">Add to calendar</p><a href="${g}" style="${btn}">Google Calendar</a><a href="${f}" style="${btn}">Apple / Outlook</a></div>`;
}
