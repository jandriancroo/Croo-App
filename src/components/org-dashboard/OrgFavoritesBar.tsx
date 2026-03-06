import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Search, Star, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface LocationOption {
  id: string;
  name: string;
  storeNumber?: string | null;
}

interface OrgFavoritesBarProps {
  allLocations: LocationOption[];
  favorites: string[];
  onFavoritesChange: (ids: string[]) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
}

export function OrgFavoritesBar({ 
  allLocations, 
  favorites, 
  onFavoritesChange,
  showAll,
  onToggleShowAll,
}: OrgFavoritesBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchOpen]);

  const filtered = query.trim()
    ? allLocations.filter(loc => {
        const q = query.toLowerCase();
        return loc.name.toLowerCase().includes(q) || 
               (loc.storeNumber && loc.storeNumber.includes(q));
      })
    : [];

  const addFavorite = useCallback((id: string) => {
    if (favorites.length >= 5 || favorites.includes(id)) return;
    onFavoritesChange([...favorites, id]);
    setQuery('');
    setSearchOpen(false);
  }, [favorites, onFavoritesChange]);

  const removeFavorite = useCallback((id: string) => {
    onFavoritesChange(favorites.filter(f => f !== id));
  }, [favorites, onFavoritesChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && filtered.length > 0) {
      addFavorite(filtered[0].id);
    }
    if (e.key === 'Escape') {
      setSearchOpen(false);
      setQuery('');
    }
  };

  const getLocationLabel = (id: string) => {
    const loc = allLocations.find(l => l.id === id);
    if (!loc) return 'Unknown';
    return loc.storeNumber ? `${loc.name} - ${loc.storeNumber}` : loc.name;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Favorite chips */}
        {favorites.map(id => (
          <Badge 
            key={id} 
            variant="secondary" 
            className="flex items-center gap-1 pl-2 pr-1 py-1 text-xs cursor-default"
          >
            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
            <span className="truncate max-w-[120px]">{getLocationLabel(id)}</span>
            <button 
              onClick={() => removeFavorite(id)} 
              className="ml-0.5 hover:bg-muted rounded p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        {/* Add button / search */}
        {favorites.length < 5 && (
          <div className="relative">
            {searchOpen ? (
              <div className="relative">
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => { 
                    setTimeout(() => { setSearchOpen(false); setQuery(''); }, 200); 
                  }}
                  placeholder="Type name or store #..."
                  className="h-7 text-xs w-48 pl-7"
                />
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                
                {/* Dropdown */}
                {filtered.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-popover border rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                    {filtered.slice(0, 8).map(loc => (
                      <button
                        key={loc.id}
                        onMouseDown={() => addFavorite(loc.id)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center justify-between"
                        disabled={favorites.includes(loc.id)}
                      >
                        <span>{loc.storeNumber ? `${loc.name} - ${loc.storeNumber}` : loc.name}</span>
                        {favorites.includes(loc.id) && (
                          <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-foreground px-3 py-1.5 rounded-lg border-2 border-dashed border-muted-foreground/40 hover:border-primary hover:text-primary transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Pin Store ({5 - favorites.length} left)
              </button>
            )}
          </div>
        )}

        {/* Show all toggle */}
        <button
          onClick={onToggleShowAll}
          className={`ml-auto text-xs px-2 py-1 rounded-md transition-colors ${
            showAll 
              ? 'bg-primary/10 text-primary font-medium' 
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {showAll ? 'Showing All' : 'Show All'}
        </button>
      </div>
    </div>
  );
}
