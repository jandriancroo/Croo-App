/**
 * Pure summary math for the "send home early" cut plan.
 *
 * The dollar figure always comes from the server (get_cut_savings_total), which
 * prices each eligible cut at that person's real wage and returns only the
 * aggregate. No per-person dollars are computed or shown on any device.
 */
export interface CutSavingsSummaryInput {
  totalMinutesCut: number;
  /** Aggregate dollars from the server; null when unavailable. */
  estSavings: number | null;
  currentLaborCost: number;
  totalSales: number;
}

export interface CutSavingsSummary {
  totalMinutesCut: number;
  dollarsKnown: boolean;
  totalCostSaved: number | null;
  newLaborCost: number | null;
  currentLaborCost: number;
  currentLaborPercent: number;
  newLaborPercent: number;
  percentSaved: number;
}

export const summarizeCuts = (a: CutSavingsSummaryInput): CutSavingsSummary => {
  const dollarsKnown = a.estSavings != null;
  const totalCostSaved = dollarsKnown ? a.estSavings! : null;
  const newLaborCost = dollarsKnown ? Math.max(0, a.currentLaborCost - totalCostSaved!) : null;
  const currentLaborPercent = a.totalSales > 0 ? (a.currentLaborCost / a.totalSales) * 100 : 0;
  const newLaborPercent =
    a.totalSales > 0 && newLaborCost != null
      ? (newLaborCost / a.totalSales) * 100
      : currentLaborPercent;

  return {
    totalMinutesCut: a.totalMinutesCut,
    dollarsKnown,
    totalCostSaved,
    newLaborCost,
    currentLaborCost: a.currentLaborCost,
    currentLaborPercent,
    newLaborPercent,
    percentSaved: currentLaborPercent - newLaborPercent,
  };
};
