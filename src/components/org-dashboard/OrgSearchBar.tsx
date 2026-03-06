import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search, X } from 'lucide-react';

export interface SearchableLocation {
  id: string;
  name: string;
  storeNumber?: string | null;
  orgName?: string | null;
  brandName?: string | null;
}

export interface SearchTag {
  type: 'location' | 'org' | 'brand';
  id: string;
  label: string;
}

interface OrgSearchBarProps {
  locations: SearchableLocation[];
  tags: SearchTag[];
  onTagsChange: (tags: SearchTag[]) => void;
}

export function OrgSearchBar({ locations, tags, onTagsChange }: OrgSearchBarProps) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Build searchable suggestions: locations + unique orgs + unique brands
  const suggestions = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const results: { type: SearchTag['type']; id: string; label: string; sub?: string }[] = [];

    // Locations matching name or store number
    for (const loc of locations) {
      if (
        loc.name.toLowerCase().includes(q) ||
        (loc.storeNumber && loc.storeNumber.includes(q))
      ) {
        const alreadyTagged = tags.some(t => t.type === 'location' && t.id === loc.id);
        if (!alreadyTagged) {
          results.push({
            type: 'location',
            id: loc.id,
            label: loc.storeNumber ? `${loc.name} #${loc.storeNumber}` : loc.name,
            sub: loc.orgName || undefined,
          });
        }
      }
    }

    // Unique org names
    const orgNames = new Set<string>();
    for (const loc of locations) {
      if (loc.orgName && loc.orgName.toLowerCase().includes(q) && !orgNames.has(loc.orgName)) {
        orgNames.add(loc.orgName);
        const alreadyTagged = tags.some(t => t.type === 'org' && t.label === loc.orgName);
        if (!alreadyTagged) {
          results.push({ type: 'org', id: loc.orgName, label: loc.orgName });
        }
      }
    }

    // Unique brand names
    const brandNames = new Set<string>();
    for (const loc of locations) {
      if (loc.brandName && loc.brandName.toLowerCase().includes(q) && !brandNames.has(loc.brandName)) {
        brandNames.add(loc.brandName);
        const alreadyTagged = tags.some(t => t.type === 'brand' && t.label === loc.brandName);
        if (!alreadyTagged) {
          results.push({ type: 'brand', id: loc.brandName, label: loc.brandName });
        }
      }
    }

    return results.slice(0, 10);
  }, [query, locations, tags]);

  const addTag = useCallback((suggestion: { type: SearchTag['type']; id: string; label: string }) => {
    onTagsChange([...tags, { type: suggestion.type, id: suggestion.id, label: suggestion.label }]);
    setQuery('');
    inputRef.current?.focus();
  }, [tags, onTagsChange]);

  const removeTag = useCallback((idx: number) => {
    onTagsChange(tags.filter((_, i) => i !== idx));
  }, [tags, onTagsChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && query === '' && tags.length > 0) {
      removeTag(tags.length - 1);
    }
    if (e.key === 'Enter' && suggestions.length > 0) {
      e.preventDefault();
      addTag(suggestions[0]);
    }
    if (e.key === 'Escape') {
      setFocused(false);
      setQuery('');
    }
  };

  const typeColors: Record<SearchTag['type'], string> = {
    location: 'bg-primary/15 text-primary',
    org: 'bg-accent/20 text-accent-foreground',
    brand: 'bg-secondary text-secondary-foreground',
  };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <div
        className={`flex items-center gap-1 flex-wrap rounded-lg border px-2 py-1 transition-colors min-h-[36px] ${
          focused ? 'border-primary ring-1 ring-primary/20' : 'border-border'
        }`}
        onClick={() => inputRef.current?.focus()}
      >
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        
        {tags.map((tag, i) => (
          <span
            key={`${tag.type}-${tag.id}-${i}`}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeColors[tag.type]}`}
          >
            {tag.label}
            <button
              onClick={(e) => { e.stopPropagation(); removeTag(i); }}
              className="hover:opacity-60 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'Search stores, orgs, brands...' : 'Add more...'}
          className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      {/* Dropdown */}
      {focused && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-56 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={`${s.type}-${s.id}-${i}`}
              onMouseDown={() => addTag(s)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${typeColors[s.type]}`}>
                  {s.type === 'location' ? 'Store' : s.type === 'org' ? 'Org' : 'Brand'}
                </span>
                <span className="truncate font-medium">{s.label}</span>
              </div>
              {s.sub && <span className="text-[10px] text-muted-foreground shrink-0">{s.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
