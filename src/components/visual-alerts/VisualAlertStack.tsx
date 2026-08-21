import { useEffect, useMemo } from "react";
import { useSearchParams, useLocation } from "react-router-dom";

import { useVisualAlerts } from "@/hooks/useVisualAlerts";
import { VisualAlertCard } from "./VisualAlertCard";

// Routes where we never show the stack (auth, kiosk, public, etc.)
const SUPPRESS_PREFIXES = [
  "/auth",
  "/reset-password",
  "/forgot-password",
  "/welcome",
  "/punch",
  "/kiosk",
  "/applicant",
  "/jobs",
  "/complete/", // already in the flow they'd be sent to
  "/complete-checklist/",
];

export function VisualAlertStack() {
  const { alerts, markSeen } = useVisualAlerts();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const suppress = useMemo(
    () => SUPPRESS_PREFIXES.some((p) => location.pathname.startsWith(p)),
    [location.pathname]
  );

  // Reorder so a deep-linked alert is on top
  const targetNotificationId = searchParams.get("alert");
  const ordered = useMemo(() => {
    if (!targetNotificationId) return alerts;
    const idx = alerts.findIndex((a) => a.notification_id === targetNotificationId);
    if (idx < 0) return alerts;
    const arr = [...alerts];
    const [hit] = arr.splice(idx, 1);
    arr.push(hit);
    return arr;
  }, [alerts, targetNotificationId]);

  // Strip ?alert= from URL once we've consumed it so it doesn't re-fire
  useEffect(() => {
    if (targetNotificationId && ordered.length > 0) {
      const next = new URLSearchParams(searchParams);
      next.delete("alert");
      setSearchParams(next, { replace: true });
    }
  }, [targetNotificationId, ordered.length, searchParams, setSearchParams]);

  if (suppress || ordered.length === 0) return null;

  // Top card = last in array
  const topIndex = ordered.length - 1;
  const top = ordered[topIndex];
  const isLast = ordered.length === 1;

  const handleNext = () => {
    markSeen(top.id);
  };

  const handleCloseAll = () => {
    Promise.all(ordered.map((a) => markSeen(a.id)));
  };

  // Render up to 3 stacked layers behind the top card
  const stackLayers = ordered.slice(Math.max(0, topIndex - 3), topIndex);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
      <div className="relative w-full max-w-sm">
        {stackLayers.map((card, i) => {
          const depth = stackLayers.length - i; // 1 = closest behind top
          const rotate = (i % 2 === 0 ? -1 : 1) * (2 + depth);
          const translateY = depth * 8;
          const scale = 1 - depth * 0.04;
          return (
            <div
              key={card.id}
              className="absolute inset-0 rounded-2xl bg-card border border-border/30 shadow-xl"
              style={{
                transform: `translateY(${translateY}px) scale(${scale}) rotate(${rotate}deg)`,
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
            remaining={ordered.length}
            isLast={isLast}
            onNext={handleNext}
            onCloseAll={handleCloseAll}
          />
        </div>
      </div>
    </div>
  );
}

