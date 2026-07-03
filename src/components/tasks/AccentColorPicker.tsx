import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, Pipette } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccentColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

/** Theme-based suggested chip colors (match dashboard quick task palette). */
const SUGGESTED_COLORS: { value: string; label: string }[] = [
  { value: "#CD7A4A", label: "Orange" },
  { value: "#5F8D99", label: "Teal" },
  { value: "#7F77DD", label: "Purple" },
  { value: "#4F9D78", label: "Green" },
  { value: "#C45C7C", label: "Rose" },
  { value: "#D4A574", label: "Sand" },
];

/** Broader palette below the suggestions. */
const EXTRA_COLORS: { value: string; label: string }[] = [
  { value: "#8B5CF6", label: "Violet" },
  { value: "#10B981", label: "Emerald" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#EF4444", label: "Red" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#EC4899", label: "Pink" },
  { value: "#14B8A6", label: "Teal Vivid" },
  { value: "#6366F1", label: "Indigo" },
  { value: "#84CC16", label: "Lime" },
  { value: "#F97316", label: "Orange Vivid" },
  { value: "#0EA5E9", label: "Sky" },
  { value: "#64748B", label: "Slate" },
];

function Swatch({
  color,
  label,
  active,
  onClick,
}: {
  color: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "relative h-8 w-8 rounded-lg transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        active && "ring-2 ring-ring ring-offset-1"
      )}
      style={{ backgroundColor: color }}
    >
      {active && (
        <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" strokeWidth={3} />
      )}
    </button>
  );
}

export function AccentColorPicker({ value, onChange }: AccentColorPickerProps) {
  const currentLabel =
    [...SUGGESTED_COLORS, ...EXTRA_COLORS].find(
      (c) => c.value.toLowerCase() === value?.toLowerCase()
    )?.label || "Custom";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 font-normal"
        >
          <span
            className="h-4 w-4 rounded-full border border-border/50 shrink-0"
            style={{ backgroundColor: value }}
          />
          <span className="flex-1 text-left">{currentLabel}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            {value}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Theme suggestions
            </p>
            <div className="grid grid-cols-6 gap-2">
              {SUGGESTED_COLORS.map((c) => (
                <Swatch
                  key={c.value}
                  color={c.value}
                  label={c.label}
                  active={value?.toLowerCase() === c.value.toLowerCase()}
                  onClick={() => onChange(c.value)}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              More colors
            </p>
            <div className="grid grid-cols-6 gap-2">
              {EXTRA_COLORS.map((c) => (
                <Swatch
                  key={c.value}
                  color={c.value}
                  label={c.label}
                  active={value?.toLowerCase() === c.value.toLowerCase()}
                  onClick={() => onChange(c.value)}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border/50">
            <Pipette className="h-4 w-4 text-muted-foreground" />
            <label className="flex-1 text-xs font-medium text-muted-foreground">
              Custom color
            </label>
            <input
              type="color"
              value={value || "#8B5CF6"}
              onChange={(e) => onChange(e.target.value.toUpperCase())}
              className="h-8 w-14 rounded cursor-pointer border border-border bg-transparent"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
