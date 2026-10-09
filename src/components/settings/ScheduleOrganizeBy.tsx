import { Briefcase, Layers, MapPin } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useStationMode } from "@/hooks/useLocationStations";
import { toast } from "sonner";

export function ScheduleOrganizeBy({ locationId }: { locationId: string }) {
  const { enabled, isLoading, save } = useStationMode(locationId);
  return (
    <div className="flex flex-col gap-3 border-b pb-3 lg:flex-row lg:items-center">
      <div className="shrink-0 lg:w-52">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4" />Organize by</h2>
        <p className="mt-1 text-xs text-muted-foreground">Switching keeps all your settings.</p>
      </div>
      <RadioGroup className="grid flex-1 grid-cols-1 gap-1 rounded-lg bg-muted/40 p-1 sm:grid-cols-2"
        value={enabled ? "station" : "position"} disabled={isLoading || save.isPending}
        onValueChange={async value => {
          try {
            await save.mutateAsync(value === "station");
            toast.success(value === "station" ? "Stations enabled" : "Stations disabled");
          } catch { toast.error("Could not save stations setting"); }
        }}>
        {([
          ["position", "Position", Briefcase, "Checklists filter by position. Schedule layout stays the same."],
          ["station", "Station", MapPin, "Schedule groups into station sections; checklists follow the station."],
        ] as const).map(([value, label, Icon, text]) => (
          <label key={value} className={`flex cursor-pointer items-start gap-2 rounded-md p-2 transition-colors ${enabled === (value === "station") ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
            <RadioGroupItem value={value} aria-label={label} className="mt-0.5 shrink-0" />
            <span className="min-w-0"><span className="flex items-center gap-1 text-sm font-medium"><Icon className="h-3.5 w-3.5" />{label}</span><span className="mt-0.5 block text-[11px] leading-snug opacity-80">{text}</span></span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}