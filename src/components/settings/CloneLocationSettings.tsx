import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Loader2, X, ArrowRight } from 'lucide-react';
import { useCloneLocationSettings, CloneType } from '@/hooks/useCloneLocationSettings';

interface LocationOption {
  id: string;
  name: string;
  organization_id: string;
  orgName?: string;
}

const CLONE_OPTIONS: { type: CloneType; label: string; description: string }[] = [
  { type: 'shift_templates', label: 'Shift Templates', description: 'All shift templates with positions' },
  { type: 'checklists', label: 'Checklists', description: 'All active checklists with items & role tags' },
  { type: 'logbook_categories', label: 'Logbook Categories', description: 'Logbook category names and settings' },
  { type: 'writeup_reasons', label: 'Corrective Action Reasons', description: 'Corrective action reason templates' },
];

export function CloneLocationSettings() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceLocationId, setSourceLocationId] = useState<string>('');
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<CloneType[]>(['shift_templates', 'checklists', 'logbook_categories', 'writeup_reasons']);
  const { cloning, results, cloneSettings } = useCloneLocationSettings();

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, organization_id, organizations(name)')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      setLocations((data || []).map((l: any) => ({
        id: l.id,
        name: l.name,
        organization_id: l.organization_id,
        orgName: l.organizations?.name || 'Unknown',
      })));
    } catch (err) {
      console.error('Error fetching locations:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleTarget = (id: string) => {
    setSelectedTargets(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const toggleType = (type: CloneType) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const selectAllTargets = () => {
    const available = locations.filter(l => l.id !== sourceLocationId).map(l => l.id);
    setSelectedTargets(prev => prev.length === available.length ? [] : available);
  };

  const handleClone = () => {
    const nameMap: Record<string, string> = {};
    locations.forEach(l => { nameMap[l.id] = l.name; });
    cloneSettings(sourceLocationId, selectedTargets, selectedTypes, nameMap);
  };

  // Group locations by org
  const targetLocations = locations.filter(l => l.id !== sourceLocationId);
  const groupedTargets = targetLocations.reduce((acc, l) => {
    const key = l.orgName || 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(l);
    return acc;
  }, {} as Record<string, LocationOption[]>);

  const sourceName = locations.find(l => l.id === sourceLocationId)?.name;

  if (loading) return <p className="text-sm text-muted-foreground">Loading locations...</p>;

  return (
    <div className="space-y-5">
      {/* Source */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Source Location</label>
        <Select value={sourceLocationId} onValueChange={(v) => { setSourceLocationId(v); setSelectedTargets([]); }}>
          <SelectTrigger>
            <SelectValue placeholder="Select source location to clone from" />
          </SelectTrigger>
          <SelectContent>
            {locations.map(l => (
              <SelectItem key={l.id} value={l.id}>
                {l.name} <span className="text-muted-foreground ml-1">({l.orgName})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {sourceLocationId && (
        <>
          {/* What to clone */}
          <div className="space-y-2">
            <label className="text-sm font-medium">What to Clone</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CLONE_OPTIONS.map(opt => (
                <label
                  key={opt.type}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedTypes.includes(opt.type)
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <Checkbox
                    checked={selectedTypes.includes(opt.type)}
                    onCheckedChange={() => toggleType(opt.type)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Targets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Target Locations</label>
              <Button variant="ghost" size="sm" onClick={selectAllTargets} className="text-xs h-7">
                {selectedTargets.length === targetLocations.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <div className="max-h-[300px] overflow-y-auto rounded-lg border divide-y">
              {Object.entries(groupedTargets).map(([orgName, locs]) => (
                <div key={orgName}>
                  <div className="px-3 py-1.5 bg-muted/50 text-xs font-medium text-muted-foreground sticky top-0">
                    {orgName}
                  </div>
                  {locs.map(l => (
                    <label
                      key={l.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors ${
                        selectedTargets.includes(l.id) ? 'bg-primary/5' : ''
                      }`}
                    >
                      <Checkbox
                        checked={selectedTargets.includes(l.id)}
                        onCheckedChange={() => toggleTarget(l.id)}
                      />
                      <span className="text-sm">{l.name}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            {selectedTargets.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedTargets.map(id => {
                  const loc = locations.find(l => l.id === id);
                  return (
                    <Badge key={id} variant="secondary" className="gap-1 pr-1">
                      {loc?.name}
                      <button onClick={() => toggleTarget(id)} className="hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleClone}
              disabled={cloning || !selectedTargets.length || !selectedTypes.length}
              className="gap-2"
            >
              {cloning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cloning...
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Clone from {sourceName}
                  <ArrowRight className="h-4 w-4" />
                  {selectedTargets.length} location{selectedTargets.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-2 pt-2">
              <label className="text-sm font-medium text-primary flex items-center gap-1">
                <Check className="h-4 w-4" /> Clone Results
              </label>
              <div className="rounded-lg border divide-y text-sm max-h-[200px] overflow-y-auto">
                {results.map((r, i) => (
                  <div key={i} className="px-3 py-2 flex items-center justify-between">
                    <span>
                      <span className="font-medium">{r.targetName}</span>
                      <span className="text-muted-foreground"> · {r.type.replace(/_/g, ' ')}</span>
                    </span>
                    <span className="text-xs">
                      {r.count > 0 && <Badge variant="default" className="mr-1">{r.count} added</Badge>}
                      {r.skipped > 0 && <Badge variant="secondary">{r.skipped} skipped</Badge>}
                      {r.count === 0 && r.skipped === 0 && <span className="text-muted-foreground">nothing to clone</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
