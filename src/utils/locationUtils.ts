/**
 * Formats a location name with store number if available
 * Example: "Hemet" with store_number "1341" becomes "Hemet - 1341"
 */
export function formatLocationName(name: string, storeNumber?: string | null): string {
  if (storeNumber) {
    return `${name} - ${storeNumber}`;
  }
  return name;
}
