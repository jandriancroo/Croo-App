
import { useState, useMemo } from 'react';
import { MapPin, Search, Star, ChevronRight, Clock } from 'lucide-react';

const BRANDS = [
  { id: 'blaze', name: 'Blaze Pizza' },
  { id: 'crumbl', name: 'Crumbl' },
];

const LOCATIONS = [
  { id: '1', name: 'Pasadena', num: '#001', brand: 'blaze' },
  { id: '2', name: 'Hollywood', num: '#002', brand: 'blaze' },
  { id: '3', name: 'Glendale', num: '#003', brand: 'blaze' },
  { id: '4', name: 'Burbank', num: '#004', brand: 'blaze' },
  { id: '5', name: 'Irvine', num: '#005', brand: 'blaze' },
  { id: '6', name: 'Arcadia', num: '#006', brand: 'blaze' },
  { id: '7', name: 'Torrance', num: '#007', brand: 'blaze' },
  { id: '8', name: 'Santa Monica', num: '#008', brand: 'crumbl' },
  { id: '9', name: 'Long Beach', num: '#009', brand: 'crumbl' },
  { id: '10', name: 'Newport', num: '#010', brand: 'crumbl' },
  { id: '11', name: 'Anaheim', num: '#011', brand: 'crumbl' },
];

const RECENTS = [
  { id: '1', ago: '2 min ago' },
  { id: '4', ago: 'Yesterday' },
  { id: '8', ago: '3 days ago' },
];

const SHOW_RECENTS_THRESHOLD = 10;

export default function LocationPickerPreview() {
  const [selected, setSelected] = useState('1');
  const [defaultLoc, setDefaultLoc] = useState('1');
  const [activeBrand, setActiveBrand] = useState<string | 'recents'>('recents');
  const [search, setSearch] = useState('');

  const totalLocations = LOCATIONS.length;
  const showRecents = totalLocations >= SHOW_RECENTS_THRESHOLD;

  // If recents not available, default to first brand
  const effectiveBrand = activeBrand === 'recents' && !showRecents ? BRANDS[0].id : activeBrand;

  const filteredLocations = useMemo(() => {
    if (effectiveBrand === 'recents') {
      const recentIds = RECENTS.map(r => r.id);
      let locs = LOCATIONS.filter(l => recentIds.includes(l.id));
      if (search.trim()) {
        const q = search.toLowerCase();
        locs = locs.filter(l => l.name.toLowerCase().includes(q) || l.num.includes(q));
      }
      return locs;
    }
    let locs = LOCATIONS.filter(l => l.brand === effectiveBrand);
    if (search.trim()) {
      const q = search.toLowerCase();
      locs = locs.filter(l => l.name.toLowerCase().includes(q) || l.num.includes(q));
    }
    return locs;
  }, [effectiveBrand, search]);

  const tabs = useMemo(() => {
    const t: { id: string; label: string }[] = [];
    if (showRecents) t.push({ id: 'recents', label: 'Recent' });
    BRANDS.forEach(b => t.push({ id: b.id, label: b.name }));
    return t;
  }, [showRecents]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 pb-32">
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Location Picker — Hybrid</h1>
          <p className="text-muted-foreground mt-1">Brand tabs + Search + Recents (10+ locations)</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Showing {totalLocations} locations — recents tab {showRecents ? 'visible' : 'hidden'}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl max-w-sm overflow-hidden shadow-xl">
          {/* Header */}
          <div className="p-4 pb-3 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-primary" /> Select Location
            </h3>

            {/* Tabs */}
            <div className="flex bg-muted/50 rounded-lg p-1 gap-0.5">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveBrand(tab.id); setSearch(''); }}
                  className={`flex-1 text-xs font-medium text-center py-1.5 rounded-md transition-all flex items-center justify-center gap-1 ${
                    effectiveBrand === tab.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.id === 'recents' && <Clock className="h-3 w-3" />}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Search + list */}
          <div className="p-3">
            <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 mb-3 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={effectiveBrand === 'recents' ? 'Search recents...' : 'Search locations...'}
                className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
              />
            </div>

            <div className="space-y-1">
              {filteredLocations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No locations found</p>
              ) : (
                filteredLocations.map(loc => {
                  const recent = effectiveBrand === 'recents' ? RECENTS.find(r => r.id === loc.id) : null;
                  return (
                    <button
                      key={loc.id}
                      onClick={() => setSelected(loc.id)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg transition-all text-left ${
                        selected === loc.id
                          ? 'bg-primary/10 ring-2 ring-primary'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); setDefaultLoc(loc.id === defaultLoc ? '' : loc.id); }}
                        className="p-0.5 hover:scale-110 transition-transform"
                      >
                        <Star className={`h-3.5 w-3.5 flex-shrink-0 ${
                          defaultLoc === loc.id
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-muted-foreground hover:text-yellow-400'
                        }`} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm block ${selected === loc.id ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                          {loc.name} {loc.num}
                        </span>
                        {recent && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="h-2.5 w-2.5" /> {recent.ago}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
