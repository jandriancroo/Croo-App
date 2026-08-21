import { useState } from "react";
import { Button } from "@/components/ui/button";
import { VisualAlertCard } from "@/components/visual-alerts/VisualAlertCard";
import type { VisualAlert } from "@/hooks/useVisualAlerts";

const MOCK: VisualAlert[] = [
  {
    id: "m1",
    notification_id: "n1",
    alert_type: "overdue_checklist",
    title: "Overdue Checklist - Georgetown",
    body: "Morning Shift Checklist not completed, 18 tasks remaining",
  },
  {
    id: "m2",
    notification_id: "n2",
    alert_type: "quick_task",
    title: "Walk-in Temp Check",
    body: "Log the walk-in cooler temperature before 11:00 AM.",
  },
  {
    id: "m3",
    notification_id: "n3",
    alert_type: "overdue_checklist",
    title: "Overdue Checklist - Palm Springs",
    body: "Daily Deep Cleaning not completed, 6 tasks remaining",
  },
] as unknown as VisualAlert[];

export default function VisualAlertPreview() {
  const [queue, setQueue] = useState<VisualAlert[]>(MOCK);

  const reset = () => setQueue(MOCK);

  const topIndex = queue.length - 1;
  const top = queue[topIndex];
  const stackLayers = queue.slice(Math.max(0, topIndex - 3), topIndex);

  return (
    <div className="min-h-screen bg-muted/30 p-6 flex flex-col items-center gap-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-semibold">Pop-up notification preview</h1>
        <p className="text-sm text-muted-foreground">
          X bubble top-left closes all. Bottom button says Next, then Done on the last card.
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="text-center space-y-4 py-16">
          <p className="text-sm text-muted-foreground">All caught up — stack dismissed.</p>
          <Button onClick={reset}>Replay preview</Button>
        </div>
      ) : (
        <div className="relative w-full max-w-sm mt-6">
          {stackLayers.map((card, i) => {
            const depth = stackLayers.length - i;
            const rotate = (i % 2 === 0 ? -1 : 1) * (2 + depth);
            return (
              <div
                key={card.id}
                className="absolute inset-0 rounded-2xl bg-card border border-border/30 shadow-xl"
                style={{
                  transform: `translateY(${depth * 8}px) scale(${1 - depth * 0.04}) rotate(${rotate}deg)`,
                  opacity: 0.7 - depth * 0.15,
                  zIndex: i,
                }}
                aria-hidden
              />
            );
          })}
          <div className="relative" style={{ zIndex: stackLayers.length + 1 }}>
            <VisualAlertCard
              alert={top}
              remaining={queue.length}
              isLast={queue.length === 1}
              onNext={() => setQueue((q) => q.slice(0, -1))}
              onCloseAll={() => setQueue([])}
            />
          </div>
        </div>
      )}
    </div>
  );
}
