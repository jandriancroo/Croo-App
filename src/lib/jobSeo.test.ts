import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PINNED_PUBLIC_JOBS,
  assertHomepageShell,
  assertJobHtml,
  assertJobsIndexHtml,
  buildJobPosting,
  buildJobSlug,
  buildJobsIndexDocument,
  injectJobDocument,
  type JobRecord,
} from "./jobSeo";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NOW = new Date("2026-11-09T12:00:00Z");
const HEMET_LOGO = "https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/organization-branding/logos/11111111-1111-1111-1111-111111111111-1764831763669.png";
const PALM_LOGO = "https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/organization-branding/logos/new-1765253274428.png";

const TEAM_MEMBER_DESCRIPTION = `We’re looking for energetic, customer-focused individuals to help create fast, fresh, artisanal pizzas in a fun, high-energy environment.
As a Team Member, you’ll prepare ingredients, build custom pizzas, work the oven and cash register, deliver outstanding guest service, and keep the restaurant clean and organized.`;

const SHIFT_MANAGER_DESCRIPTION = `We’re hiring a Shift Manager to lead our team at Blaze Pizza. You’ll be responsible for running smooth, efficient shifts while delivering an exceptional guest experience and maintaining high food quality and safety standards.
Previous leadership or restaurant experience preferred.`;

const HEMET_ADDRESS = "3260 W Florida Ave, Hemet, CA 92545";
const PALM_ADDRESS = "201 N Palm Canyon Dr, Palm Springs, CA 92262";

function listing(partial: JobRecord): JobRecord {
  return partial;
}

const LIVE: Record<string, JobRecord> = {
  "hemet-team-member-e766b367": listing({
    id: "e766b367-6f2d-4ff6-b2d2-fecbea22cfa3",
    title: "Team Member",
    description: TEAM_MEMBER_DESCRIPTION,
    employment_type: "part_time",
    pay_min: 20,
    pay_max: 20,
    pay_type: "hourly",
    posted_at: "2026-04-02T07:43:09.642+00:00",
    location: { name: "Hemet", address: HEMET_ADDRESS },
    organization: { name: "Jo Pizza LLC", slug: "jo-pizza-llc", brand_name: "Blaze Pizza", logo_url: HEMET_LOGO },
  }),
  "hemet-shift-manager-e80d9518": listing({
    id: "e80d9518-ccef-4340-8abb-4aabe51f5e2c",
    title: "Shift Manager",
    description: SHIFT_MANAGER_DESCRIPTION,
    employment_type: "full_time",
    pay_min: 22,
    pay_max: 23,
    pay_type: "hourly",
    posted_at: "2026-04-02T07:43:03.359+00:00",
    location: { name: "Hemet", address: HEMET_ADDRESS },
    organization: { name: "Jo Pizza LLC", slug: "jo-pizza-llc", brand_name: "Blaze Pizza", logo_url: HEMET_LOGO },
  }),
  "palm-springs-team-member-bcdcd6b8": listing({
    id: "bcdcd6b8-c990-492c-891d-3fb74e9c2c86",
    title: "Team Member",
    description: TEAM_MEMBER_DESCRIPTION,
    employment_type: "full_time",
    pay_min: 20,
    pay_max: 20,
    pay_type: "hourly",
    posted_at: "2026-04-02T08:13:03.511+00:00",
    location: { name: "Palm Springs", address: PALM_ADDRESS },
    organization: { name: "DDM Pizza", slug: "ddm-pizza", brand_name: "Blaze Pizza", logo_url: PALM_LOGO },
  }),
};

describe("public job JSON-LD", () => {
  const shell = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  it("keeps the homepage canonical on / and does not strip a job canonical", () => {
    expect(shell).toContain('href="https://croohq.com/"');
    expect(shell).toContain("function isHome");
    expect(shell).not.toContain("if (c) c.remove()");
    assertHomepageShell(shell);
  });

  it("builds the three live slugs from the street addresses", () => {
    for (const pin of PINNED_PUBLIC_JOBS) {
      expect(buildJobSlug(LIVE[pin.slug])).toBe(pin.slug);
    }
  });

  it("puts a complete Hemet JobPosting in raw HTML for each live slug", () => {
    const pages = PINNED_PUBLIC_JOBS.map((pin) => {
      const built = buildJobPosting(LIVE[pin.slug], NOW);
      expect(built.gaps, pin.slug).toEqual([]);
      const posting = built.posting;
      expect(posting.title).toBe(pin.title);
      expect(posting.directApply).toBe(true);
      expect(posting.industry).toBe("Food Services");
      const address = (posting.jobLocation as { address: Record<string, string> }).address;
      expect(address.addressCountry).toBe("US");
      expect(address.addressRegion).toBe("CA");
      expect(address.addressLocality).toBe(pin.city);
      const org = posting.hiringOrganization as { name: string; sameAs: string; logo: string };
      expect(org.logo.startsWith("https://")).toBe(true);
      expect(org.logo).not.toContain("croohq-logo");
      const html = injectJobDocument(shell, built.document);
      const notes = assertJobHtml(html, pin);
      expect(notes.join("\n"), pin.slug).toContain("food service");
      expect(html).not.toContain("SoftwareApplication");
      expect(html).toContain('id="root"');
      expect(html).toContain("/src/main.tsx");
      return built;
    });

    const hemetTeam = pages[0].posting;
    const hemetManager = pages[1].posting;
    const palm = pages[2].posting;
    expect((hemetTeam.jobLocation as { address: Record<string, string> }).address.streetAddress).toBe("3260 W Florida Ave");
    expect((hemetTeam.jobLocation as { address: Record<string, string> }).address.postalCode).toBe("92545");
    expect((hemetTeam.baseSalary as { value: { minValue: number; maxValue: number; unitText: string } }).value).toMatchObject({
      minValue: 20, maxValue: 20, unitText: "HOUR",
    });
    expect(hemetTeam.employmentType).toBe("PART_TIME");
    expect((hemetManager.baseSalary as { value: { minValue: number; maxValue: number } }).value).toMatchObject({ minValue: 22, maxValue: 23 });
    expect(hemetManager.employmentType).toBe("FULL_TIME");
    expect(String(hemetManager.description).toLowerCase()).toContain("food");
    expect((palm.jobLocation as { address: Record<string, string> }).address).toMatchObject({
      streetAddress: "201 N Palm Canyon Dr",
      addressLocality: "Palm Springs",
      postalCode: "92262",
    });
    expect((palm.hiringOrganization as { logo: string }).logo).toBe(PALM_LOGO);

    const index = buildJobsIndexDocument(PINNED_PUBLIC_JOBS.map((pin) => LIVE[pin.slug]), NOW);
    const indexHtml = injectJobDocument(shell, index.document);
    assertJobsIndexHtml(indexHtml);
    expect(indexHtml).toContain("https://croohq.com/jobs/hemet-team-member-e766b367");
    expect(indexHtml).toContain("https://croohq.com/jobs/palm-springs-team-member-bcdcd6b8");
  });

  it("does not invent pay, a street address, or a logo", () => {
    const built = buildJobPosting({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      title: "Team Member",
      description: "Hello <b>there</b>",
      employment_type: "part_time",
      pay_min: null,
      pay_max: null,
      pay_type: "hourly",
      posted_at: "2026-04-02T00:00:00Z",
      location: { name: "Hemet", address: null },
      organization: { name: "Jo Pizza LLC", slug: "jo-pizza-llc", brand_name: "Blaze Pizza", logo_url: null },
    }, NOW);
    expect(built.posting.baseSalary).toBeUndefined();
    expect(built.posting.jobLocation).toBeUndefined();
    expect((built.posting.hiringOrganization as { logo?: string }).logo).toBeUndefined();
    expect(built.gaps).toEqual(expect.arrayContaining([
      "jobLocation.address.streetAddress missing",
      "jobLocation.address.addressLocality missing",
      "jobLocation.address.postalCode missing",
      "baseSalary missing (listing has no pay_min or pay_max)",
      "hiringOrganization.logo missing (organization.logo_url is empty or not an https URL)",
    ]));
    const html = injectJobDocument(shell, built.document);
    expect(html).not.toContain("<b>");
    expect(html).toContain("\\u003cb>");
    expect(html).not.toContain("3260 W Florida");
  });
});
