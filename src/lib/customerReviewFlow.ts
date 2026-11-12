import { clipAnswers, runsMultipleLocations, type ReviewAnswers } from "../../supabase/functions/write-customer-review/combine.ts";

export const INTRO = "Got 3 minutes? Tell us how CrooHQ's working for your store. We'll polish it up, and you approve every word.";
export const HEADACHE = "What was the biggest headache in running your store before CrooHQ?";
export const MULTI = "What surprised you most about owning multiple locations?";
export const FEATURE = "Which CrooHQ feature would you miss most if it disappeared tomorrow?";
export const HELPED = "How has CrooHQ helped?";
export const THEO = "What do you ask Theo?";
export const ADVICE = "What would you tell another operator who's thinking about trying it?";
export const ANYTHING_ELSE = "Anything else you want to say?";
export const CONSENT = "I give CrooHQ permission to use my testimonial, name, role, and restaurant name on its website, social media, and marketing materials. I can ask for it to be removed at any time by emailing jordan@croohq.com.";
export const ANONYMOUS = "Keep me anonymous. Show only my role and restaurant type (for example, Owner, fast-casual pizza, CA).";

export const ROLES = ["Owner", "GM", "Manager", "Other"] as const;
export const LOCATION_CHOICES = ["1", "2-5", "6+"] as const;
export const FEATURES = [
  "Scheduling",
  "Shift coverage / Theo",
  "Checklists",
  "Daily numbers",
  "Cash logs",
  "Time clock",
  "Multi-location view",
] as const;

export type StepId =
  | "intro"
  | "who"
  | "headache"
  | "multi"
  | "feature"
  | "helped"
  | "theo"
  | "advice"
  | "else"
  | "writing"
  | "edit"
  | "approve"
  | "thanks";

export type ReviewForm = {
  name: string;
  role: string;
  roleOther: string;
  restaurant: string;
  locationCount: "" | "1" | "2-5" | "6+";
  headache: string;
  multi: string;
  feature: string;
  featureNote: string;
  helped: string;
  theo: string;
  advice: string;
  elseNote: string;
  restaurantType: string;
  state: string;
  anonymous: boolean;
  consent: boolean;
  finalText: string;
};

export const EMPTY_REVIEW_FORM: ReviewForm = {
  name: "",
  role: "",
  roleOther: "",
  restaurant: "",
  locationCount: "",
  headache: "",
  multi: "",
  feature: "",
  featureNote: "",
  helped: "",
  theo: "",
  advice: "",
  elseNote: "",
  restaurantType: "",
  state: "",
  anonymous: false,
  consent: false,
  finalText: "",
};

const HOUR = 60 * 60 * 1000;
const MAX_PER_HOUR = 3;
const RATE_KEY = "croohq-review-submits";

export function displayRole(form: Pick<ReviewForm, "role" | "roleOther">): string {
  return form.role === "Other" ? form.roleOther.trim() : form.role.trim();
}

export function interviewSteps(locationCount: string): StepId[] {
  const steps: StepId[] = ["intro", "who", "headache"];
  if (runsMultipleLocations(locationCount)) steps.push("multi");
  steps.push("feature", "helped", "theo", "advice", "else");
  return steps;
}

export function attributionLine(form: ReviewForm): string {
  const role = displayRole(form);
  if (form.anonymous) return [role, form.restaurantType.trim(), form.state.trim()].filter(Boolean).join(", ");
  return [form.name.trim(), role, form.restaurant.trim()].filter(Boolean).join(", ");
}

export function stepError(step: StepId, form: ReviewForm): string {
  if (step === "who") {
    if (!form.name.trim() || !form.restaurant.trim() || !form.locationCount) {
      return "Add your name, your restaurant, and how many locations you run.";
    }
    if (!form.role) return "Choose your role.";
    if (!displayRole(form)) return "Tell us your role.";
  }
  if (step === "headache" && !form.headache.trim()) return "Tell us the headache, in your own words.";
  if (step === "multi" && !form.multi.trim()) return "Tell us what surprised you.";
  if (step === "feature" && !form.feature && !form.featureNote.trim()) return "Pick a feature, or write the one you'd miss.";
  if (step === "helped" && !form.helped.trim()) return "Tell us how CrooHQ has helped.";
  if (step === "advice" && !form.advice.trim()) return "Add what you'd tell another operator.";
  if (step === "edit" && !form.finalText.trim()) return "Write the review in your own words.";
  if (step === "approve") {
    if (!form.consent) return "Check the permission box to approve.";
    if (form.anonymous && (!form.restaurantType.trim() || !form.state.trim())) {
      return "Add the restaurant type and state for the public line.";
    }
  }
  return "";
}

export function toReviewAnswers(form: ReviewForm): ReviewAnswers {
  return clipAnswers({
    name: form.name,
    role: displayRole(form),
    restaurant: form.restaurant,
    locationCount: form.locationCount,
    headache: form.headache,
    multiLocationSurprise: runsMultipleLocations(form.locationCount) ? form.multi : "",
    feature: form.feature,
    featureNote: form.featureNote,
    helped: form.helped,
    theo: form.theo,
    advice: form.advice,
    anythingElse: form.elseNote,
  });
}

export function reviewSubmitTimes(storage: Pick<Storage, "getItem">, now = Date.now()): number[] {
  try {
    const parsed = JSON.parse(storage.getItem(RATE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter(value => Number.isFinite(value) && now - value < HOUR);
  } catch {
    return [];
  }
}

export function reviewRateLimited(storage: Pick<Storage, "getItem"> = localStorage, now = Date.now()): boolean {
  return reviewSubmitTimes(storage, now).length >= MAX_PER_HOUR;
}

export function rememberReviewSubmit(storage: Pick<Storage, "getItem" | "setItem"> = localStorage, now = Date.now()) {
  const times = [...reviewSubmitTimes(storage, now), now];
  storage.setItem(RATE_KEY, JSON.stringify(times));
}
