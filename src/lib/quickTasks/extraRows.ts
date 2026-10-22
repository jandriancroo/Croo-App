import type { LucideIcon } from "lucide-react";

/** Faint background tint that tells system / document / account rows apart in the Dash Quick Tasks card. */
export type QuickTaskWash = "teal" | "amber" | "red";

/** A row that a non-temporary-task source (cash, spot check, Read & Sign, I-9, PIN) adds to the Quick Tasks card. */
export interface QuickExtraRow {
  key: string;
  title: string;
  icon: LucideIcon;
  wash: QuickTaskWash;
  dueLabel?: string | null;
  overdue: boolean;
  onSelect: () => void;
}

export const parseHHMM = (timeStr: string | null | undefined): number | null => {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
};

/** Overdue = inside the last 30 minutes of a visible window. */
export const inLastHalfHour = (nowMin: number, windowEnd: number) => nowMin >= windowEnd - 30;

/**
 * Cash-count visibility, moved word for word from CashHandlingTasks:
 * AM safe = open ±2h, PM safe and drawer = close → close+2h, hidden once submitted today.
 */
export function cashTaskWindows(args: {
  openMin: number | null;
  closeMin: number | null;
  nowMin: number;
  amSubmitted: boolean;
  pmSubmitted: boolean;
  depositSubmitted: boolean;
}) {
  const { openMin, closeMin, nowMin, amSubmitted, pmSubmitted, depositSubmitted } = args;
  const amStart = openMin !== null ? openMin - 120 : null;
  const amEnd = openMin !== null ? openMin + 120 : null;
  const showAm = !amSubmitted && amStart !== null && amEnd !== null && nowMin >= amStart && nowMin <= amEnd;
  const pmStart = closeMin;
  const pmEnd = closeMin !== null ? closeMin + 120 : null;
  const inPm = pmStart !== null && pmEnd !== null && nowMin >= pmStart && nowMin <= pmEnd;
  return {
    showAm,
    showPm: !pmSubmitted && inPm,
    showDeposit: !depositSubmitted && inPm,
    amOverdue: showAm && amEnd !== null && inLastHalfHour(nowMin, amEnd),
    pmOverdue: inPm && pmEnd !== null && inLastHalfHour(nowMin, pmEnd),
  };
}

/** Spot check: close → close+2h, same as DailySpotCheckTask. */
export function spotCheckWindow(closeMin: number | null, nowMin: number) {
  if (closeMin === null) return { show: false, overdue: false };
  const show = nowMin >= closeMin && nowMin <= closeMin + 120;
  return { show, overdue: show && inLastHalfHour(nowMin, closeMin + 120) };
}

/** PIN reminder due 15 days after account creation (the old "Required" point). */
export function pinDue(createdAt: string | null | undefined, now: Date = new Date()) {
  if (!createdAt) return { label: "Due in 15 days", overdue: false };
  const due = new Date(createdAt).getTime() + 15 * 86400000;
  const days = Math.ceil((due - now.getTime()) / 86400000);
  if (days <= 0) return { label: "Due today", overdue: true };
  return { label: days === 1 ? "Due in 1 day" : `Due in ${days} days`, overdue: false };
}

/** Red rows first, then amber, then the existing rows, then teal. */
export function splitExtraRows(rows: QuickExtraRow[]) {
  return {
    red: rows.filter((r) => r.wash === "red"),
    amber: rows.filter((r) => r.wash === "amber"),
    teal: rows.filter((r) => r.wash === "teal"),
  };
}
