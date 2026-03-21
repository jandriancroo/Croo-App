
import { useState } from 'react';
import { MapPin, Search, Star, ChevronRight, Building2, Check, Clock, ArrowRight, Command, CornerDownLeft, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

const LOCATIONS = [
  { id: '1', name: 'Pasadena', num: '#001', brand: 'Blaze Pizza', code: 'PAS', color: 'hsl(189 45% 42%)' },
  { id: '2', name: 'Hollywood', num: '#002', brand: 'Blaze Pizza', code: 'HWD', color: 'hsl(22 80% 58%)' },
  { id: '3', name: 'Glendale', num: '#003', brand: 'Blaze Pizza', code: 'GLD', color: 'hsl(220 40% 55%)' },
  { id: '4', name: 'Burbank', num: '#004', brand: 'Blaze Pizza', code: 'BUR', color: 'hsl(280 30% 50%)' },
];

export default function LocationPickerPreview() {
  const [selected, setSelected] = useState<Record<string, string>>({
    '1': '1', '2': '1', '3': '1', '4': '1', '5': '1'
  });

  const select = (option: string, id: string) => setSelected(p => ({ ...p, [option]: id }));

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 pb-32">
      <div className="max-w-5xl mx-auto space-y-10">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Location Picker Concepts</h1>
          <p className="text-muted-foreground mt-1">5 design directions — tap locations to interact</p>
        </div>

        {/* Option 1: Clean Card Stack */}
        <section className="space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-primary">01</span>
            <div>
              <h2 className="text-lg font-bold text-foreground">Clean Card Stack</h2>
              <p className="text-xs text-muted-foreground">Minimal • Flat cards • Search + bold hierarchy</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl max-w-sm overflow-hidden shadow-lg">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" /> Select Location
              </h3>
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 mb-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Search locations...</span>
              </div>
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider px-1 mb-1.5">Blaze Pizza</p>
              <div className="space-y-1">
                {LOCATIONS.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => select('1', loc.id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg transition-all text-left ${
                      selected['1'] === loc.id 
                        ? 'bg-primary/10 ring-2 ring-primary' 
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <Star className={`h-3.5 w-3.5 flex-shrink-0 ${selected['1'] === loc.id ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                    <span className={`text-sm flex-1 ${selected['1'] === loc.id ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {loc.name} {loc.num}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Option 2: Map-Style Tiles */}
        <section className="space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-accent">02</span>
            <div>
              <h2 className="text-lg font-bold text-foreground">Map-Style Tiles</h2>
              <p className="text-xs text-muted-foreground">Visual • Grid layout • Color-coded brands</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl max-w-sm overflow-hidden shadow-lg">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Your Locations</h3>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2.5">
              {LOCATIONS.map(loc => (
                <button
                  key={loc.id}
                  onClick={() => select('2', loc.id)}
                  className={`relative rounded-xl p-3 text-left transition-all overflow-hidden ${
                    selected['2'] === loc.id ? 'ring-2 ring-white shadow-lg scale-[1.02]' : 'hover:scale-[1.01]'
                  }`}
                  style={{ backgroundColor: `color-mix(in srgb, ${loc.color} 20%, hsl(var(--card)))` }}
                >
                  <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl" style={{ backgroundColor: loc.color }} />
                  <span className="text-lg font-bold block" style={{ color: loc.color }}>{loc.code}</span>
                  <span className="text-sm text-foreground block mt-1">{loc.name}</span>
                  <span className="text-[10px] mt-2 block" style={{ color: selected['2'] === loc.id ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>
                    {selected['2'] === loc.id ? '● Current' : 'Switch →'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Option 3: Command Palette */}
        <section className="space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold" style={{ color: 'hsl(260 60% 70%)' }}>03</span>
            <div>
              <h2 className="text-lg font-bold text-foreground">Command Palette</h2>
              <p className="text-xs text-muted-foreground">Power-user • Keyboard-first • Spotlight search</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl max-w-sm overflow-hidden shadow-lg" style={{ borderColor: 'hsl(260 30% 35%)' }}>
            <div className="p-3">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-2" style={{ backgroundColor: 'hsl(260 20% 18%)', border: '1px solid hsl(260 30% 30%)' }}>
                <Command className="h-4 w-4" style={{ color: 'hsl(260 60% 70%)' }} />
                <span className="text-sm" style={{ color: 'hsl(260 30% 60%)' }}>Type to switch location...</span>
              </div>
              <div className="space-y-1">
                {LOCATIONS.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => select('3', loc.id)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-3 rounded-lg transition-all text-left relative"
                    style={{
                      backgroundColor: selected['3'] === loc.id ? 'hsl(260 20% 20%)' : 'transparent',
                    }}
                  >
                    {selected['3'] === loc.id && (
                      <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r" style={{ backgroundColor: 'hsl(260 60% 70%)' }} />
                    )}
                    <div className="flex-1 ml-1">
                      <span className={`text-sm block ${selected['3'] === loc.id ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                        {loc.name} {loc.num}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Blaze Pizza · SoCal</span>
                    </div>
                    {selected['3'] === loc.id && (
                      <span className="text-[10px] flex items-center gap-1" style={{ color: 'hsl(260 60% 70%)' }}>
                        <CornerDownLeft className="h-3 w-3" /> Enter
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-4 px-2.5 pt-2 border-t border-border mt-2">
                <span className="text-[10px] text-muted-foreground">↑↓ Navigate</span>
                <span className="text-[10px] text-muted-foreground">↵ Select</span>
                <span className="text-[10px] text-muted-foreground">⎋ Close</span>
              </div>
            </div>
          </div>
        </section>

        {/* Option 4: Segmented Tabs */}
        <section className="space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-green-500">04</span>
            <div>
              <h2 className="text-lg font-bold text-foreground">Segmented Tabs</h2>
              <p className="text-xs text-muted-foreground">Organized • Tab per brand • Radio selection</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl max-w-sm overflow-hidden shadow-lg">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Switch Location</h3>
            </div>
            <div className="p-3">
              {/* Tabs */}
              <div className="flex bg-muted/50 rounded-lg p-1 mb-3">
                <div className="flex-1 bg-primary text-primary-foreground text-xs font-medium text-center py-1.5 rounded-md">Blaze Pizza</div>
                <div className="flex-1 text-muted-foreground text-xs font-medium text-center py-1.5">Crumbl</div>
                <div className="flex-1 text-muted-foreground text-xs font-medium text-center py-1.5">Other</div>
              </div>
              <div className="space-y-1">
                {LOCATIONS.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => select('4', loc.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all text-left ${
                      selected['4'] === loc.id ? 'bg-muted/60' : 'hover:bg-muted/30'
                    }`}
                  >
                    <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      selected['4'] === loc.id ? 'border-primary bg-primary' : 'border-muted-foreground'
                    }`}>
                      {selected['4'] === loc.id && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <span className={`text-sm flex-1 ${selected['4'] === loc.id ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {loc.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono">{loc.num}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Option 5: Bottom Sheet + Recents */}
        <section className="space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-red-500">05</span>
            <div>
              <h2 className="text-lg font-bold text-foreground">Bottom Sheet + Recents</h2>
              <p className="text-xs text-muted-foreground">Mobile-native • Recents first • Smart ordering</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl max-w-sm overflow-hidden shadow-lg">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
            </div>
            <div className="p-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Recent</p>
              <div className="space-y-1.5 mb-3">
                {LOCATIONS.slice(0, 2).map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => select('5', loc.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left ${
                      selected['5'] === loc.id 
                        ? 'bg-primary/10 ring-2 ring-primary' 
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex-1">
                      <span className={`text-sm block ${selected['5'] === loc.id ? 'font-semibold text-foreground' : 'text-foreground'}`}>
                        {loc.name} {loc.num}
                      </span>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {loc.id === '1' ? '2 min ago' : 'Yesterday'}
                      </span>
                    </div>
                    {selected['5'] === loc.id && (
                      <div className="h-3.5 w-3.5 rounded-full bg-primary" />
                    )}
                  </button>
                ))}
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">All Locations</p>
                <div className="space-y-1">
                  {LOCATIONS.slice(2).map(loc => (
                    <button
                      key={loc.id}
                      onClick={() => select('5', loc.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-all text-left"
                    >
                      <span className="text-sm text-muted-foreground">{loc.name} {loc.num}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
