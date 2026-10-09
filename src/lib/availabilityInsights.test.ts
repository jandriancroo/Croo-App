import { describe, expect, it } from "vitest";
import {
  buildInsightDays,
  buildInsightsHtml,
  countCreatedOnLocalDate,
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
  const rows = [
    { created_at: "2026-10-08T06:58:00Z" }, // Oct 7 11:58 PM Pacific
    { created_at: "2026-10-08T19:00:00Z" }, // Oct 8 Pacific
    { created_at: "2026-10-09T08:00:00Z" }, // Oct 9 1 AM Pacific
  ];
  it("counts by store-local calendar day", () => {
    expect(countCreatedOnLocalDate(rows, "America/Los_Angeles", "2026-10-08")).toBe(1);
    expect(countCreatedOnLocalDate(rows, "America/Los_Angeles", "2026-10-07")).toBe(1);
    expect(countCreatedOnLocalDate(rows, "America/Chicago", "2026-10-08")).toBe(2);
    expect(countCreatedOnLocalDate([], "America/Los_Angeles", "2026-10-08")).toBe(0);
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
  it("flags 2+ different people out or unavailable all day", () => {
    expect(needsCoverage(1)).toBe(false);
    expect(needsCoverage(2)).toBe(true);
    const days = buildInsightDays({
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
    const html = buildInsightsHtml({ locationId: "x", locationName: "Hemet", orgName: "Blaze", weekStart: "2026-10-12", weekEnd: "2026-10-18", days, pending: 1, approved: 1 });
    expect(html).toContain("Ana Maria Lopez");
    expect(html).toContain("PENDING");
    expect(html).toContain("COVERAGE");
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
