import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight, LucideIcon, Send } from "lucide-react";
import { ShareTaskDialog } from "./ShareTaskDialog";
import opusLogo from "@/assets/opus-logo.png";

export interface TemporaryTaskCardProps {
  id: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  /** Accent color for the chip container (hex, e.g. #cd7a4a) */
  accentColor: string;
  buttonLabel?: string;
  isLoading?: boolean;
  onAction: () => void;
  badge?: { label: string; color?: string };
  taskStyle?: "standard" | "alarm";
  iconStyle?: "default" | "minimal";
  showShare?: boolean;
  shareDetails?: string;
  subtasksCompleted?: number;
  subtasksTotal?: number;
  isOpusTask?: boolean;
}

/** Parse a #rrggbb / #rgb hex string to [r,g,b]. Returns null on failure. */
function parseHex(hex: string): [number, number, number] | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Lighten a hex color toward white by `amount` (0..1). 0.8 ≈ near-white tint. */
export function lightenHexTowardWhite(hex: string, amount = 0.8): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

export function TemporaryTaskCard({
  title,
  subtitle,
  icon: Icon,
  accentColor,
  onAction,
  badge,
  taskStyle = "standard",
  showShare = false,
  shareDetails,
  subtasksCompleted,
  subtasksTotal,
  isOpusTask = false,
}: TemporaryTaskCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const hasSubtasks = subtasksTotal !== undefined && subtasksTotal > 0;
  const countColor = lightenHexTowardWhite(accentColor, 0.8);

  return (
    <>
      <div
        className="quick-task-card group flex items-center gap-2.5 cursor-pointer transition-all hover:brightness-[1.06] active:brightness-95 active:scale-[0.995]"
        style={{
          backgroundColor: accentColor,
          borderRadius: 12,
          padding: "10px 12px",
          boxShadow: `0 1px 2px ${accentColor}55, inset 0 1px 0 rgba(255,255,255,0.12)`,
        }}
        onClick={onAction}
        role="button"
        tabIndex={0}
      >
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: "rgba(255,255,255,0.22)",
          }}
        >
          {isOpusTask ? (
            <img src={opusLogo} alt="OPUS" className="h-4 w-auto" loading="lazy" />
          ) : (
            <Icon style={{ width: 16, height: 16, color: "#fff" }} strokeWidth={2.25} />
          )}
        </div>

        <span
          className="flex-1 min-w-0 truncate"
          style={{ color: "#fff", fontSize: 14, fontWeight: 500 }}
        >
          {title}
        </span>

        {taskStyle === "alarm" && (
          <span
            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{
              backgroundColor: "rgba(255,255,255,0.22)",
              color: "#fff",
              letterSpacing: 0.3,
            }}
          >
            RECURRING
          </span>
        )}

        {hasSubtasks ? (
          <span
            className="shrink-0 tabular-nums text-right"
            style={{ color: countColor, fontSize: 13, fontWeight: 500 }}
          >
            {subtasksCompleted}/{subtasksTotal}
          </span>
        ) : badge ? (
          <span
            className="shrink-0 text-right"
            style={{ color: countColor, fontSize: 13, fontWeight: 500 }}
          >
            {badge.label}
          </span>
        ) : null}

        {showShare && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0 hover:bg-white/15"
            style={{ color: "#fff" }}
            onClick={(e) => {
              e.stopPropagation();
              setShareOpen(true);
            }}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        )}

        <ChevronRight
          className="shrink-0 transition-transform group-hover:translate-x-0.5"
          style={{ width: 16, height: 16, color: countColor, opacity: 0.85 }}
          aria-hidden
        />
      </div>


      <ShareTaskDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        taskTitle={title}
        taskDetails={shareDetails || subtitle}
        accentColor={accentColor}
      />
    </>
  );
}
