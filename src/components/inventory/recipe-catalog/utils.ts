// Sort priority for pizza cores within a size group
export function getCoreSortPriority(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes("simple pie")) return 10;
  if (lower.includes("1 top")) return 20;
  if (lower.includes("2 top")) return 30;
  if (lower.includes("3 top")) return 40;
  if (lower.includes("pepperoni pizza") || lower.includes("pepperoni lover")) return 50;
  if (lower.includes("four cheese")) return 51;
  if (lower.includes("carnivore")) return 52;
  if (lower.includes("meat eater")) return 53;
  if (lower.includes("blazed bbq") || lower.includes("blaze bbq")) return 54;
  if (lower.includes("herbivore")) return 55;
  if (lower.includes("meatball")) return 56;
  if (lower.includes("spicy double pep")) return 57;
  if (lower.includes("spicy hot chicken")) return 58;
  if (lower.includes("hot link")) return 59;
  if (lower.includes("bbq chicken")) return 60;
  if (lower.includes("garlic")) return 61;
  if (lower.includes("veg out")) return 62;
  if (lower.includes("vegan")) return 63;
  if (lower.includes("vegetarian")) return 64;
  if (lower.includes("keto")) return 65;
  if (lower.includes("protein")) return 66;
  if (lower.includes("white top")) return 67;
  if (lower.includes("green stripe")) return 68;
  if (lower.includes("red vine")) return 69;
  if (lower.includes("art lover")) return 70;
  if (lower.includes("maple") || lower.includes("squash")) return 71;
  if (lower.includes("byo")) return 200;
  return 100;
}

export function getSizeFromName(name: string): "MD" | "LG" | "HALF" | null {
  const lower = name.toLowerCase();
  if (lower.includes(" md ") || lower.includes("md -") || lower.includes("md pizza")) return "MD";
  if (lower.includes(" lg ") || lower.includes("lg -") || lower.includes("lg pizza") || lower.includes("large ")) return "LG";
  if (lower.includes("half ") || lower.includes("half pizza")) return "HALF";
  return null;
}

export function getCleanDisplayName(name: string): string {
  return name
    .replace(/^(Core (MD|LG|Large|Salad)\s*-?\s*)/i, "")
    .replace(/^(Core\s*-?\s*)/i, "")
    .replace(/^(Base\s*-?\s*)/i, "")
    .replace(/^(MI\s*-?\s*)/i, "")
    .replace(/^(Half\s*)/i, "")
    .trim();
}
