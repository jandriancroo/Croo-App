import { describe, expect, it } from "vitest";
import {
  buildInsightDays,
  buildInsightsHtml,
  countQualifyingNewRequests,
  DEFAULT_SHORT_STAFFED_THRESHOLD,
  insightsSubject,
  isInsightsHour,
  needsCoverage,
  nextWeekRange,
} from "../../supabase/functions/_shared/availabilityInsights";
import { applicantFullName, fillHiringTokens } from "../../supabase/functions/_shared/hiringNames";
import { CROO_EMAIL_LOGO, pickEmailLogo, renderEmailHeader } from "../../supabase/functions/_shared/emailHeader";

describe("7 AM local gate", () => {
  // 2026-10-09 14:00 UTC = 7 AM Pacific (PDT), 9 AM Central
  const t = new Date("2026-10-09T14:00:00Z");
  it("passes only where it is 7 AM", () => {
    expect(isInsightsHour("America/Los_Angeles", t)).toBe(true);
    expect(isInsightsHour("America/Chicago", t)).toBe(false);
    expect(isInsightsHour("America/Chicago", new Date("2026-10-09T12:00:00Z"))).toBe(true);
    expect(isInsightsHour("America/Los_Angeles", new Date("2026-10-09T13:59:00Z"))).toBe(false);
  });
});

describe("new request yesterday gate", () => {
  const W = ["2026-10-12", "2026-10-18"] as const;
  const at = "2026-10-08T19:00:00Z"; // Oct 8 Pacific
  it("counts by store-local calendar day", () => {
    const rows = [
      { created_at: "2026-10-08T06:58:00Z", start_date: "2026-10-13" }, // Oct 7 11:58 PM Pacific
      { created_at: at, start_date: "2026-10-13" },
      { created_at: "2026-10-09T08:00:00Z", start_date: "2026-10-13" }, // Oct 9 1 AM Pacific
    ];
    expect(countQualifyingNewRequests(rows, "America/Los_Angeles", "2026-10-08", ...W)).toBe(1);
    expect(countQualifyingNewRequests(rows, "America/Los_Angeles", "2026-10-07", ...W)).toBe(1);
    expect(countQualifyingNewRequests(rows, "America/Chicago", "2026-10-08", ...W)).toBe(2);
    expect(countQualifyingNewRequests([], "America/Los_Angeles", "2026-10-08", ...W)).toBe(0);
  });
  it("only counts requests that touch next week", () => {
    const tz = "America/Los_Angeles";
    expect(countQualifyingNewRequests([{ created_at: at, start_date: "2026-10-15", end_date: null }], tz, "2026-10-08", ...W)).toBe(1);
    expect(countQualifyingNewRequests([{ created_at: at, start_date: "2026-10-24", end_date: "2026-10-30" }], tz, "2026-10-08", ...W)).toBe(0);
    expect(countQualifyingNewRequests([{ created_at: at, start_date: "2026-10-19", end_date: null }], tz, "2026-10-08", ...W)).toBe(0);
    expect(countQualifyingNewRequests([{ created_at: at, start_date: "2026-10-16", end_date: "2026-10-21" }], tz, "2026-10-08", ...W)).toBe(1);
    expect(countQualifyingNewRequests([{ created_at: at, start_date: "2026-10-09", end_date: "2026-10-12" }], tz, "2026-10-08", ...W)).toBe(1);
  });
});

describe("week range", () => {
  it("is next Mon–Sun", () => {
    expect(nextWeekRange("2026-10-09")).toEqual({ weekStart: "2026-10-12", weekEnd: "2026-10-18" });
    expect(nextWeekRange("2026-10-11")).toEqual({ weekStart: "2026-10-12", weekEnd: "2026-10-18" });
    expect(nextWeekRange("2026-10-12")).toEqual({ weekStart: "2026-10-19", weekEnd: "2026-10-25" });
    expect(insightsSubject("2026-10-12", "2026-10-18")).toBe("Availability Insights · Oct 12 – Oct 18");
  });
});

describe("coverage flag", () => {
  it("defaults to 3 and honors a custom value", () => {
    expect(DEFAULT_SHORT_STAFFED_THRESHOLD).toBe(3);
    expect(needsCoverage(2)).toBe(false);
    expect(needsCoverage(3)).toBe(true);
    expect(needsCoverage(1, 1)).toBe(true);
    expect(needsCoverage(4, 5)).toBe(false);
    expect(needsCoverage(2, 0)).toBe(false); // invalid → default 3
  });
  it("flags threshold+ different people out or unavailable all day", () => {
    const days = buildInsightDays({
      threshold: 2,
      weekStart: "2026-10-12",
      requests: [
        { userId: "a", name: "Ana Maria Lopez", status: "pending", startDate: "2026-10-12", endDate: "2026-10-13", timeScope: "multi_day", startTime: null, endTime: null },
        { userId: "a", name: "Ana Maria Lopez", status: "approved", startDate: "2026-10-12", endDate: "2026-10-12", timeScope: "full_day", startTime: null, endTime: null },
      ],
      roster: [
        { userId: "b", name: "Ben Ito", weekly: { monday: { available: false }, tuesday: { available: true, blocks: [{ start: "15:00", end: "22:00" }] } } },
      ],
    });
    expect(days[0].peopleOut).toBe(2);
    expect(days[0].coverage).toBe(true);
    expect(days[1].peopleOut).toBe(1); // partial block listed, not counted
    expect(days[1].availability).toHaveLength(1);
    expect(days[1].coverage).toBe(false);
    const html = buildInsightsHtml({ locationId: "x", locationName: "Hemet", orgName: "Blaze", weekStart: "2026-10-12", weekEnd: "2026-10-18", days, pending: 1, approved: 1, threshold: 2 });
    expect(html).toContain("Ana Maria Lopez");
    expect(html).not.toContain("COVERAGE");
    expect(html).not.toContain("BUSY");
    expect(html).not.toContain("2 OUT");
    expect(html).toContain("Short-staffed (2+ out)");
    expect(html).toContain("background:#e8733d;border-radius:8px 8px 0 0");
  });
});

describe("full-name greeting", () => {
  it("uses the full name, {{first_name}} included", () => {
    expect(applicantFullName("  Jane   Q  Doe ")).toBe("Jane Q Doe");
    expect(applicantFullName("")).toBe("Applicant");
    expect(fillHiringTokens("Dear {{first_name}}, {{Name}} at {{organization}}", { name: "Jane Doe", organization: "Blaze" }))
      .toBe("Dear Jane Doe, Jane Doe at Blaze");
  });
});

describe("email header", () => {
  it("prefers brand → org → CrooHQ logo and escapes", () => {
    expect(pickEmailLogo({ brandLogo: "https://b/x.png", orgLogo: "https://o/y.png" }).source).toBe("brand");
    expect(pickEmailLogo({ brandLogo: "http://insecure", orgLogo: "https://o/y.png" }).source).toBe("organization");
    expect(pickEmailLogo({}).logoUrl).toBe(CROO_EMAIL_LOGO);
    const h = renderEmailHeader({ title: "<b>Hi</b>", logoUrl: "javascript:alert(1)" });
    expect(h).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(h).toContain(CROO_EMAIL_LOGO);
  });
});


describe("calendar email", () => {
  const requests = Array.from({ length: 6 }, (_, i) => ({ userId: `u${i}`, name: `Person ${i}`, status: "pending" as const, startDate: "2026-10-12", endDate: "2026-10-12", timeScope: "partial_day", startTime: null, endTime: "16:00", createdAt: "2026-10-10T00:14:00Z", originalWeekly: { monday: { available: true, blocks: [] } } }));
  const data = { locationId: "x", locationName: "Hemet", orgName: "Blaze", weekStart: "2026-10-12", weekEnd: "2026-10-18", days: buildInsightDays({ weekStart: "2026-10-12", requests, roster: [], goals: new Map([["2026-10-12", 2300]]) }), pending: 6, approved: 0, threshold: 3, newRequests: [requests[0]], requestDay: "2026-10-09", currentLocalDate: "2026-10-10", timezone: "America/Los_Angeles" };
  it("caps calendar pills, puts partial times below them, and links to review", () => {
    const html = buildInsightsHtml(data);
    expect(html).toContain("+ 2 more requests");
    expect(html).not.toContain("Person 4");
    expect(html).not.toContain("6 OUT");
    expect(html).not.toContain("people out");
    expect(html).toMatch(/Person 0<\/span>\s*<br\/><span style="font-size:10px;font-style:italic[^>]*>until 4 PM/);
    expect(html).toContain("$2.3k");
    expect(html).toContain('href="https://croohq.com/availability"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain("New time off requests (yesterday)");
    expect(html).toContain("Oct 9, 5:14 PM");
    expect(html).toContain("Mon Oct 12, until 4 PM");
    expect(html).toContain("Available all day");
  });
  it("labels current-day samples accurately and escapes names", () => {
    const html = buildInsightsHtml({ ...data, currentLocalDate: "2026-10-09", newRequests: [{ ...requests[0], name: "<Jo & Co>" }] });
    expect(html).toContain("New time off requests (today)");
    expect(html).toContain("&lt;Jo &amp; Co&gt;");
  });
  it("describes differing original availability for multi-day requests", () => {
    const html = buildInsightsHtml({ ...data, newRequests: [{ ...requests[0], startDate: "2026-10-16", endDate: "2026-10-17", timeScope: "multi_day", originalWeekly: { friday: { available: true, blocks: [{ start: "11:00", end: "15:00" }] }, saturday: { available: true, blocks: [] } } }] });
    expect(html).toContain("Fri: After 3 PM · Sat: Available all day");
    expect(html).toContain("Fri Oct 16 – Sat Oct 17, all day");
  });
});
