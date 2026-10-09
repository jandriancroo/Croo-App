// The ONE Toast name normalizer (server + pairing screens): strip accents, lowercase, letters only.
export function normToastName(s: unknown): string {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}
