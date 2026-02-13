import { ChevronDown, TrendingUp, Flame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Badge style variations
type BadgeStyle = 'current' | 'subtle' | 'corner' | 'outlined' | 'inline';

interface BadgeVariation {
  name: string;
  style: BadgeStyle;
}

const badgeVariations: BadgeVariation[] = [
  { name: 'A. Current — Solid centered pill', style: 'current' },
  { name: 'B. Subtle — Frosted translucent pill', style: 'subtle' },
  { name: 'C. Corner — Top-right tag', style: 'corner' },
  { name: 'D. Outlined — Bordered transparent', style: 'outlined' },
  { name: 'E. Inline — Next to sales number', style: 'inline' },
];

function BadgePreview({ style }: { style: BadgeStyle }) {
  const frostedStyle = {
    backdropFilter: 'blur(40px) saturate(180%)',
    WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  };

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      {/* Hero Tile only — focused on badge */}
      <div
        className="relative rounded-2xl px-3 py-2 border m-3"
        style={{
          backgroundColor: '#ee7a3a',
          borderColor: '#d96a2e',
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
        }}
      >
        {/* Badge rendering based on style */}
        {style === 'current' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <Badge className="text-sm font-bold border-white shadow-lg px-4 py-1.5 bg-white text-orange-500">
              🔥 On Fire
            </Badge>
          </div>
        )}

        {style === 'subtle' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div
              className="px-3 py-1 rounded-full text-xs font-semibold text-white border border-white/30 shadow-sm"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)', ...frostedStyle }}
            >
              🔥 On Fire
            </div>
          </div>
        )}

        {style === 'corner' && (
          <div className="absolute top-0 right-0 z-10">
            <div className="bg-white text-orange-500 text-[10px] font-bold px-2.5 py-1 rounded-bl-lg rounded-tr-xl shadow-md flex items-center gap-1">
              <Flame className="h-3 w-3" />
              On Fire
            </div>
          </div>
        )}

        {style === 'outlined' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="px-4 py-1.5 rounded-full text-sm font-bold text-white border-2 border-white/70 bg-transparent shadow-sm">
              🔥 On Fire
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 items-center">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5 text-white/60">TODAY'S SALES</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-extrabold text-white">$2,847</p>
              {style === 'inline' && (
                <div className="flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5">
                  <Flame className="h-3 w-3 text-white" />
                  <span className="text-[10px] font-bold text-white">On Fire</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <TrendingUp className="h-3 w-3 text-white" />
              <span className="text-[9px] font-medium text-white">+12.3% vs Thu</span>
            </div>
          </div>
          <div className="text-right space-y-0">
            <div>
              <p className="text-[9px] font-bold text-white/70">Goal</p>
              <p className="text-lg font-bold text-white">$3,800</p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-white/70">Pace</p>
              <p className="text-lg font-bold text-white">$4,120</p>
            </div>
          </div>
        </div>
      </div>

      {/* Labor tab */}
      <div className="flex justify-center pb-3">
        <div className="w-36 bg-primary rounded-b-xl px-3 py-1.5 flex items-center justify-center gap-1.5 shadow-md">
          <p className="text-xs font-bold text-white">24.2%</p>
          <p className="text-[10px] text-white/60">Labor %</p>
          <ChevronDown className="h-3 w-3 text-white/60" />
        </div>
      </div>
    </div>
  );
}

export default function SalesPreviewVariations() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Badge Style Variations</h1>
          <p className="text-sm text-muted-foreground">Same orange hero tile — 4 different badge treatments + current</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {badgeVariations.map((bv, i) => (
            <div key={i}>
              <p className="text-xs font-semibold text-muted-foreground mb-2">{bv.name}</p>
              <BadgePreview style={bv.style} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
