// Labor-feed sign-out detection (sales may keep flowing while Toast labor stops).
// Pure decision so it can be tested without a database.
export const LABOR_STALE_MIN = 30;

export type LaborDecision = {
  stale: boolean;
  staleMin: number;
  nextStage: number;
  alert: { title: string; body: string; dedupKey: string } | null;
};

export function laborStep(o: {
  locationId: string;
  storeName: string;
  laborAt: Date | null;
  now: Date;
  minutesIntoWindow: number;
  stage: number;
  dispatchResult: string | null; // only "dispatched" means a restart went out this run
  since: string; // store-local time label of laborAt
}): LaborDecision {
  const staleMin = o.laborAt ? (o.now.getTime() - o.laborAt.getTime()) / 60000 : Infinity;
  const stale = staleMin >= LABOR_STALE_MIN && o.minutesIntoWindow >= LABOR_STALE_MIN;
  if (!stale) return { stale, staleMin, nextStage: 0, alert: null };
  if (o.stage > 0) return { stale, staleMin, nextStage: o.stage, alert: null };
  const tail = o.dispatchResult === "dispatched" ? "Restarting the robot." : "A person may need to sign the robot back in.";
  return {
    stale, staleMin, nextStage: 1,
    alert: {
      title: `Toast labor stopped — ${o.storeName}`,
      body: `Clock-ins haven't updated since ${o.since}. Sales may still be flowing. ${tail}`,
      dedupKey: `toast-labor:${o.locationId}:${o.laborAt?.toISOString() ?? "none"}`,
    },
  };
}
