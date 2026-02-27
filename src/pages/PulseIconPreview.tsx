import { Activity, HeartPulse, Radio, Waves, Signal, Zap, TrendingUp, BarChart3 } from "lucide-react";

const icons = [
  { name: "Activity", Icon: Activity, desc: "Classic EKG pulse line" },
  { name: "HeartPulse", Icon: HeartPulse, desc: "Heart with pulse wave" },
  { name: "Radio", Icon: Radio, desc: "Signal / broadcast pulse" },
  { name: "Waves", Icon: Waves, desc: "Wave pattern" },
  { name: "Signal", Icon: Signal, desc: "Signal strength bars" },
  { name: "Zap", Icon: Zap, desc: "Lightning bolt energy" },
  { name: "TrendingUp", Icon: TrendingUp, desc: "Growth trend line" },
  { name: "BarChart3", Icon: BarChart3, desc: "Sales-oriented bars" },
];

export default function PulseIconPreview() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-foreground">Hourly Sales Pulse — Icon Options</h1>
          <p className="text-sm text-muted-foreground">Which icon feels right for the push notification?</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {icons.map(({ name, Icon, desc }) => (
            <div
              key={name}
              className="flex flex-col items-center gap-3 p-5 rounded-2xl border border-border bg-card hover:border-primary/40 transition-colors"
            >
              {/* Simulated notification badge */}
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">{name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>

              {/* Mini push notification preview */}
              <div className="w-full rounded-xl bg-muted/50 border border-border/50 p-2.5 flex items-start gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-foreground leading-tight">Hourly Sales Pulse</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    Goal $4,200 · Pace $3,850 · Labor 22%
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
