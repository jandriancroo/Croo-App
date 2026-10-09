// Hiring emails greet applicants by their FULL name. {{first_name}} stays a
// working token for saved templates but resolves to the full name too.
export function applicantFullName(v: unknown, fallback = "Applicant"): string {
  return String(v ?? "").trim().replace(/\s+/g, " ") || fallback;
}

export function fillHiringTokens(text: string, values: { name: string; organization: string }): string {
  return String(text ?? "")
    .replace(/{{name}}/gi, values.name)
    .replace(/{{first_name}}/gi, values.name)
    .replace(/{{organization}}/gi, values.organization);
}
