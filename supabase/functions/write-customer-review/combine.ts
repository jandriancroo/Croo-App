/** Pure drafting rules for /review. No secrets, no Deno APIs. */

export const MAX_FIELD = 600;
export const MAX_TEXT = 1200;

export type LocationCount = "1" | "2-5" | "6+";

export type ReviewAnswers = {
  name: string;
  role: string;
  restaurant: string;
  locationCount: LocationCount | "";
  headache: string;
  multiLocationSurprise: string;
  feature: string;
  featureNote: string;
  helped: string;
  theo: string;
  advice: string;
  anythingElse: string;
};

export const SYSTEM_PROMPT = `You turn a restaurant operator's own answers into one short testimonial.
Rules:
- Write 2 to 4 sentences, first person, in their voice.
- Use plain words. No hype, no slogans, no exclamation points, no marketing adjectives.
- Use only facts and numbers that appear in their answers. Do not add a store count, a dollar amount, a time saved, a percent, or any other number they did not write.
- Always spell the product CrooHQ. If they wrote QHQ, Crew HQ, Croo HQ, CrewHQ, or croohq, write CrooHQ.
- Never name a POS vendor or any point-of-sale brand.
- Never say "rip and replace".
- Skip blank answers. Do not mention that the paragraph was edited or generated.
- Return only the paragraph.`;

const BRAND = [
  /\bcrew\s*hq\b/gi,
  /\bcroo\s*hq\b/gi,
  /\bqhq\b/gi,
  /\bcroohq\b/gi,
];

const POS_VENDOR = /\b(?:toast|clover|aloha|revel|qubeyond|heartland|spoton|touchbistro|touch\s+bistro|lightspeed|micros|brink|square)\b/gi;
const RIP = /\brip[\s-]+and[\s-]+replace\b/gi;

export function clip(value: unknown, max = MAX_FIELD): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function clipAnswers(input: Partial<ReviewAnswers> | null | undefined): ReviewAnswers {
  const location = clip(input?.locationCount, 8);
  const locationCount: ReviewAnswers["locationCount"] =
    location === "1" || location === "2-5" || location === "6+" ? location : "";
  return {
    name: clip(input?.name, 120),
    role: clip(input?.role, 80),
    restaurant: clip(input?.restaurant, 160),
    locationCount,
    headache: clip(input?.headache),
    multiLocationSurprise: clip(input?.multiLocationSurprise),
    feature: clip(input?.feature, 80),
    featureNote: clip(input?.featureNote),
    helped: clip(input?.helped),
    theo: clip(input?.theo),
    advice: clip(input?.advice),
    anythingElse: clip(input?.anythingElse),
  };
}

export function runsMultipleLocations(locationCount: string): boolean {
  return locationCount === "2-5" || locationCount === "6+";
}

export function normalizeBrand(text: string): string {
  return BRAND.reduce((next, pattern) => next.replace(pattern, "CrooHQ"), text);
}

export function scrubPublicText(text: string): string {
  const cleaned = normalizeBrand(text)
    .replace(POS_VENDOR, "our old system")
    .replace(RIP, "")
    .replace(/!+/g, ".")
    .replace(/\bour old system(?:\s+our old system)+\b/gi, "our old system")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/^[“"'\s]+|[”"'\s]+$/g, "")
    .trim();
  return limitSentences(cleaned, 4).slice(0, MAX_TEXT).trim();
}

export function limitSentences(text: string, max: number): string {
  const parts = text.split(/(?<=[.])\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length <= max) return text.trim();
  return parts.slice(0, max).join(" ");
}

export function sourceText(answers: ReviewAnswers): string {
  return [
    answers.name,
    answers.role,
    answers.restaurant,
    answers.locationCount,
    answers.headache,
    runsMultipleLocations(answers.locationCount) ? answers.multiLocationSurprise : "",
    answers.feature,
    answers.featureNote,
    answers.helped,
    answers.theo,
    answers.advice,
    answers.anythingElse,
  ].filter(Boolean).join("\n");
}

export function inventedNumbers(output: string, source: string): boolean {
  const sourceNums = new Set((source.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []));
  return (output.match(/\d+(?:\.\d+)?/g) ?? []).some(num => !sourceNums.has(num));
}

function asSentence(text: string): string {
  const clean = scrubPublicText(text);
  if (!clean) return "";
  return /[.]$/.test(clean) ? clean : `${clean}.`;
}

export function stitchFallback(answers: ReviewAnswers): string {
  const feature = [answers.feature, answers.featureNote].filter(Boolean).join(". ");
  const parts = [
    answers.headache,
    runsMultipleLocations(answers.locationCount) ? answers.multiLocationSurprise : "",
    feature,
    answers.helped,
    answers.theo,
    answers.advice,
    answers.anythingElse,
  ].map(asSentence).filter(Boolean).slice(0, 4);
  return parts.join(" ").slice(0, MAX_TEXT).trim();
}

export function userPrompt(answers: ReviewAnswers): string {
  const lines = [
    `Name: ${answers.name}`,
    `Role: ${answers.role}`,
    `Restaurant: ${answers.restaurant}`,
    `Locations they run: ${answers.locationCount || "not said"}`,
    `Biggest headache before CrooHQ: ${answers.headache || "(blank)"}`,
  ];
  if (runsMultipleLocations(answers.locationCount)) {
    lines.push(`What surprised them about multiple locations: ${answers.multiLocationSurprise || "(blank)"}`);
  }
  lines.push(
    `Feature they would miss: ${answers.feature || "(blank)"}`,
    `More about that feature: ${answers.featureNote || "(blank)"}`,
    `How CrooHQ has helped: ${answers.helped || "(blank)"}`,
    `What they ask Theo: ${answers.theo || "(blank)"}`,
    `What they would tell another operator: ${answers.advice || "(blank)"}`,
    `Anything else: ${answers.anythingElse || "(blank)"}`,
  );
  return lines.join("\n");
}

export function acceptDraft(raw: string, answers: ReviewAnswers): { text: string; drafted: boolean } {
  const fallback = stitchFallback(answers);
  const text = scrubPublicText(raw);
  if (!text || text.length < 40 || inventedNumbers(text, sourceText(answers))) {
    return { text: fallback, drafted: false };
  }
  return { text, drafted: true };
}
