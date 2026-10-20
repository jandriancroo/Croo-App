import { cn } from "@/lib/utils";

interface DayToggleRowProps {
  value: number[];
  /** Called with the tapped day; the caller keeps its own toggle rule. */
  onToggle: (day: number) => void;
  days: { value: number; label: string }[];
  disabled?: boolean;
  className?: string;
}

export function DayToggleRow({ value, onToggle, days, disabled, className }: DayToggleRowProps) {
  return (
    <div className={cn("flex justify-between gap-1", className)}>
      {days.map((d) => {
        const on = value.includes(d.value);
        return (
          <button
            key={d.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(d.value)}
            className={cn(
              "h-10 w-10 shrink-0 rounded-full text-[13px] font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none",
              on ? "bg-primary text-primary-foreground" : "bg-foreground/[0.06] text-foreground",
            )}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}
