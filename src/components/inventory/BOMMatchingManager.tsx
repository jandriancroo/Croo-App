import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, X, Search, Wand2, Link2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';

interface BOMMatchingManagerProps {
  locationId: string;
}

interface BOMIngredient {
  id: string;
  r365_name: string;
  clean_name: string;
  category: string;
  inventory_item_id: string | null;
}

interface InventoryItem {
  id: string;
  name: string;
  item_number: string | null;
}

// Normalize string for comparison - remove noise words and special chars
function normalizeForMatch(str: string): string[] {
  const noise = ['the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'at', 'to'];
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !noise.includes(w));
}

// Fuzzy match score (0-1, higher = better match)
function fuzzyMatch(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Exact match
  if (s1 === s2) return 1;
  
  // One contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  
  // Word-based matching (order doesn't matter)
  const words1 = normalizeForMatch(str1);
  const words2 = normalizeForMatch(str2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  // Count matching words (substring match counts)
  let matchCount = 0;
  for (const w1 of words1) {
    for (const w2 of words2) {
      // Check if words are similar enough
      if (w1 === w2 || w1.includes(w2) || w2.includes(w1)) {
        matchCount++;
        break;
      }
      // Levenshtein-like: if words are very similar
      if (w1.length > 3 && w2.length > 3) {
        const shorter = w1.length < w2.length ? w1 : w2;
        const longer = w1.length < w2.length ? w2 : w1;
        if (longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.7)))) {
          matchCount += 0.7;
          break;
        }
      }
    }
  }
  
  // Score based on how many words matched
  const maxWords = Math.max(words1.length, words2.length);
  const score = matchCount / maxWords;
  
  return score;
}

export function BOMMatchingManager({ locationId }: BOMMatchingManagerProps) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);
  const [isAutoMatching, setIsAutoMatching] = useState(false);

  // Fetch BOM ingredients
  const { data: ingredients = [], isLoading: loadingIngredients } = useQuery({
    queryKey: ['bom-ingredients', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bom_ingredients')
        .select('id, r365_name, clean_name, category, inventory_item_id')
        .eq('location_id', locationId)
        .order('category', { ascending: true })
        .order('r365_name', { ascending: true });
      
      if (error) throw error;
      return data as BOMIngredient[];
    },
  });

  // Fetch inventory items for matching
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ['inventory-items-for-matching', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, name, item_number')
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('name', { ascending: true });
      
      if (error) throw error;
      return data as InventoryItem[];
    },
  });

  // Get unique categories
  const categories = [...new Set(ingredients.map(i => i.category))].sort();

  // Update match mutation
  const updateMatch = useMutation({
    mutationFn: async ({ ingredientId, inventoryItemId }: { ingredientId: string; inventoryItemId: string | null }) => {
      const { error } = await supabase
        .from('bom_ingredients')
        .update({ inventory_item_id: inventoryItemId })
        .eq('id', ingredientId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom-ingredients', locationId] });
    },
  });

  // Auto-match function - optimized to not freeze UI
  const runAutoMatch = async () => {
    setIsAutoMatching(true);
    
    try {
      const unmatchedIngredients = ingredients.filter(i => !i.inventory_item_id);
      const matches: { ingredientId: string; inventoryItemId: string }[] = [];
      
      // Process in chunks to avoid blocking UI
      const CHUNK_SIZE = 20;
      for (let i = 0; i < unmatchedIngredients.length; i += CHUNK_SIZE) {
        const chunk = unmatchedIngredients.slice(i, i + CHUNK_SIZE);
        
        for (const ingredient of chunk) {
          let bestMatch: InventoryItem | null = null;
          let bestScore = 0;
          
          for (const item of inventoryItems) {
            const score = Math.max(
              fuzzyMatch(ingredient.clean_name || '', item.name),
              fuzzyMatch(ingredient.r365_name, item.name)
            );
            
            if (score > bestScore && score >= 0.4) {
              bestScore = score;
              bestMatch = item;
            }
          }
          
          if (bestMatch) {
            matches.push({
              ingredientId: ingredient.id,
              inventoryItemId: bestMatch.id,
            });
          }
        }
        
        // Yield to UI thread between chunks
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      // Batch update all matches at once
      if (matches.length > 0) {
        const BATCH_SIZE = 50;
        for (let i = 0; i < matches.length; i += BATCH_SIZE) {
          const batch = matches.slice(i, i + BATCH_SIZE);
          
          // Update each in the batch
          await Promise.all(
            batch.map(({ ingredientId, inventoryItemId }) =>
              supabase
                .from('bom_ingredients')
                .update({ inventory_item_id: inventoryItemId })
                .eq('id', ingredientId)
            )
          );
          
          // Yield between batches
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        // Refresh data once at the end
        queryClient.invalidateQueries({ queryKey: ['bom-ingredients', locationId] });
      }
      
      toast.success(`Auto-matched ${matches.length} ingredients`);
    } catch (error) {
      toast.error('Auto-match failed');
      console.error(error);
    } finally {
      setIsAutoMatching(false);
    }
  };

  // Filter ingredients
  const filteredIngredients = ingredients.filter(ing => {
    if (searchTerm && !ing.r365_name.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    if (categoryFilter !== 'all' && ing.category !== categoryFilter) {
      return false;
    }
    if (showUnmatchedOnly && ing.inventory_item_id) {
      return false;
    }
    return true;
  });

  // Stats
  const matchedCount = ingredients.filter(i => i.inventory_item_id).length;
  const unmatchedCount = ingredients.length - matchedCount;

  // Get matched inventory item name
  const getMatchedItemName = (inventoryItemId: string | null) => {
    if (!inventoryItemId) return null;
    const item = inventoryItems.find(i => i.id === inventoryItemId);
    return item?.name || 'Unknown';
  };

  if (loadingIngredients) {
    return <div className="p-4 text-muted-foreground">Loading BOM data...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Stats & Actions */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            {matchedCount} matched
          </Badge>
          <Badge variant="outline" className="text-sm">
            {unmatchedCount} unmatched
          </Badge>
        </div>
        
        <Button 
          onClick={runAutoMatch} 
          disabled={isAutoMatching || unmatchedCount === 0}
          size="sm"
        >
          <Wand2 className="h-4 w-4 mr-2" />
          {isAutoMatching ? 'Matching...' : 'Auto-Match'}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search ingredients..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Button
          variant={showUnmatchedOnly ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowUnmatchedOnly(!showUnmatchedOnly)}
        >
          <AlertCircle className="h-4 w-4 mr-1" />
          Unmatched Only
        </Button>
      </div>

      {/* Ingredients List */}
      <ScrollArea className="h-[400px] border rounded-lg">
        <div className="divide-y">
          {filteredIngredients.map((ingredient) => (
            <div 
              key={ingredient.id} 
              className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 hover:bg-muted/50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs shrink-0">
                    {ingredient.category}
                  </Badge>
                  <span className="font-medium truncate text-sm">
                    {ingredient.r365_name}
                  </span>
                </div>
                {ingredient.inventory_item_id && (
                  <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
                    <Check className="h-3 w-3" />
                    <span>→ {getMatchedItemName(ingredient.inventory_item_id)}</span>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={ingredient.inventory_item_id || 'none'}
                  onValueChange={(value) => {
                    updateMatch.mutate({
                      ingredientId: ingredient.id,
                      inventoryItemId: value === 'none' ? null : value,
                    });
                  }}
                >
                  <SelectTrigger className="w-[180px] h-8 text-xs">
                    <SelectValue placeholder="Link to inventory..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">No match</span>
                    </SelectItem>
                    {inventoryItems.map(item => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {ingredient.inventory_item_id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => updateMatch.mutate({
                      ingredientId: ingredient.id,
                      inventoryItemId: null,
                    })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          
          {filteredIngredients.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              No ingredients found
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
