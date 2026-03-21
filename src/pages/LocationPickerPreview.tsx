
import { useState, useMemo } from 'react';
import { MapPin, Search, Star, ChevronRight } from 'lucide-react';

const BRANDS = [
  { id: 'blaze', name: 'Blaze Pizza' },
  { id: 'crumbl', name: 'Crumbl' },
];

const LOCATIONS = [
  { id: '1', name: 'Pasadena', num: '#001', brand: 'blaze' },
  { id: '2', name: 'Hollywood', num: '#002', brand: 'blaze' },
  { id: '3', name: 'Glendale', num: '#003', brand: 'blaze' },
  { id: '4', name: 'Burbank', num: '#004', brand: 'blaze' },
  { id: '5', name: 'Irvine', num: '#005', brand: 'crumbl' },
  { id: '6', name: 'Santa Monica', num: '#006', brand: 'crumbl' },
  { id: '7', name: 'Long Beach', num: '#007', brand: 'crumbl' },
];

export default function LocationPickerPreview() {
  const [selected, setSelected] = useState('1');
  const [defaultLoc, setDefaultLoc] = useState('1');
  const [activeBrand, setActiveBrand] = useState('blaze');
  const [search, setSearch] = useState('');

  const filteredLocations = useMemo(() => {
    let locs = LOCATIONS.filter(l => l.brand === activeBrand);
    if (search.trim()) {
      const q = search.toLowerCase();
      locs = locs.filter(l => 
        l.name.toLowerCase().includes(q) || l.num.includes(q)
      );
    }
    return locs;
  }, [activeBrand, search]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 pb-32">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Location Picker — Hybrid</h1>
          <p className="text-muted-foreground mt-1">Brand tabs (04) + Search & card stack (01)</p>
        </div>

        {/* The hybrid picker */}
        <div className="bg-card border border-border rounded-2xl max-w-sm overflow-hidden shadow-xl">
          {/* Header */}
          <div className="p-4 pb-3 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-primary" /> Select Location
            </h3>

            {/* Brand tabs */}
            <div className="flex bg-muted/50 rounded-lg p-1">
              {BRANDS.map(brand => (
                <button
                  key={brand.id}
                  onClick={() => { setActiveBrand(brand.id); setSearch(''); }}
                  className={`flex-1 text-xs font-medium text-center py-1.5 rounded-md transition-all ${
                    activeBrand === brand.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {brand.name}
                </button>
              ))}
            </div>
          </div>

          {/* Search + list */}
          <div className="p-3">
            {/* Search bar */}
            <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 mb-3 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search locations..."
                className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
              />
            </div>

            {/* Location list */}
            <div className="space-y-1">
              {filteredLocations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No locations found</p>
              ) : (
                filteredLocations.map(loc => (
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
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
