/**
 * Pure helpers for the punch-clock Manager Dashboard "send home early" preview.
 *
 * The paired iPad never receives per-person wages. Estimated dollar savings are
 * derived from the store-total blended rate (labor cost / labor hours) returned
 * by get_live_labor_totals, so only aggregate dollars are ever shown.
 */

/** Store-wide blended hourly rate, or null when hours aren't available yet. */
export const blendedHourlyRate = (laborCost: number, laborHours: number): number | null =>
  laborHours > 0 ? laborCost / laborHours : null;

export interface KioskCutSavings {
  totalMinutesCut: number;
  blendedRate: number | null;
  /** null when the blended rate is unavailable — show minutes only. */
  totalCostSaved: number | null;
  /** null when the blended rate is unavailable. Never below 0. */
  newLaborCost: number | null;
}

export const calcKioskCutSavings = (
  totalMinutesCut: number,
  laborCost: number,
  laborHours: number
): KioskCutSavings => {
  const blendedRate = blendedHourlyRate(laborCost, laborHours);
  const totalCostSaved = blendedRate == null ? null : (totalMinutesCut / 60) * blendedRate;
  const newLaborCost =
    totalCostSaved == null ? null : Math.max(0, laborCost - totalCostSaved);
  return { totalMinutesCut, blendedRate, totalCostSaved, newLaborCost };
};
