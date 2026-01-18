import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Check, X, Search, Wand2, RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface BOMMenuItemMatcherProps {
  locationId: string;
}

interface BOMMenuItem {
  id: string;
  r365_name: string;
  clean_name: string | null;
  category: string | null;
  qubeyond_item_id: string | null;
  is_sellable: boolean | null;
}

interface QuProduct {
  name: string;
  quantity: number;
  sales: number;
  category: string;
}

// Normalize for matching
function normalizeForMatch(str: string): string[] {
  const noise = ['the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'at', 'to', 'mi', '-'];
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !noise.includes(w));
}

function fuzzyMatch(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  
  const words1 = normalizeForMatch(str1);
  const words2 = normalizeForMatch(str2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  let matchCount = 0;
  for (const w1 of words1) {
    for (const w2 of words2) {
      if (w1 === w2 || w1.includes(w2) || w2.includes(w1)) {
        matchCount++;
        break;
      }
    }
  }
  
  return matchCount / Math.max(words1.length, words2.length);
}

export function BOMMenuItemMatcher({ locationId }: BOMMenuItemMatcherProps) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(true);
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  const [quProducts, setQuProducts] = useState<QuProduct[]>([]);
  const [isFetchingQu, setIsFetchingQu] = useState(false);

  // Fetch BOM menu items (sellable only for POC)
  const { data: menuItems = [], isLoading } = useQuery({
    queryKey: ['bom-menu-items', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bom_menu_items')
        .select('id, r365_name, clean_name, category, qubeyond_item_id, is_sellable')
        .eq('location_id', locationId)
        .eq('is_sellable', true)
        .order('r365_name', { ascending: true });
      
      if (error) throw error;
      return data as BOMMenuItem[];
    },
  });

  // Fetch QU products on demand
  const fetchQuProducts = async () => {
    setIsFetchingQu(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-qubeyond-sales', {
        body: { locationId }
      });
      
      if (error) throw error;
      
      const products = data?.productMix || [];
      setQuProducts(products);
      toast.success(`Loaded ${products.length} products from QU`);
    } catch (error) {
      console.error('Failed to fetch QU products:', error);
      toast.error('Failed to fetch QU products');
    } finally {
      setIsFetchingQu(false);
    }
  };

  // Update match mutation
  const updateMatch = useMutation({
    mutationFn: async ({ menuItemId, quProductName }: { menuItemId: string; quProductName: string | null }) => {
      const { error } = await supabase
        .from('bom_menu_items')
        .update({ qubeyond_item_id: quProductName })
        .eq('id', menuItemId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom-menu-items', locationId] });
    },
  });

  // Auto-match function
  const runAutoMatch = async () => {
    if (quProducts.length === 0) {
      toast.error('Fetch QU products first');
      return;
    }
    
    setIsAutoMatching(true);
    
    try {
      const unmatchedItems = menuItems.filter(i => !i.qubeyond_item_id);
      const matches: { menuItemId: string; quProductName: string }[] = [];
      
      for (const menuItem of unmatchedItems) {
        let bestMatch: QuProduct | null = null;
        let bestScore = 0;
        
        for (const product of quProducts) {
          const score = Math.max(
            fuzzyMatch(menuItem.clean_name || '', product.name),
            fuzzyMatch(menuItem.r365_name, product.name)
          );
          
          if (score > bestScore && score >= 0.5) {
            bestScore = score;
            bestMatch = product;
          }
        }
        
        if (bestMatch) {
          matches.push({
            menuItemId: menuItem.id,
            quProductName: bestMatch.name,
          });
        }
        
        // Yield to UI
        if (matches.length % 20 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      // Batch update
      if (matches.length > 0) {
        for (let i = 0; i < matches.length; i += 50) {
          const batch = matches.slice(i, i + 50);
          await Promise.all(
            batch.map(({ menuItemId, quProductName }) =>
              supabase
                .from('bom_menu_items')
                .update({ qubeyond_item_id: quProductName })
                .eq('id', menuItemId)
            )
          );
        }
        queryClient.invalidateQueries({ queryKey: ['bom-menu-items', locationId] });
      }
      
      toast.success(`Auto-matched ${matches.length} menu items`);
    } catch (error) {
      toast.error('Auto-match failed');
      console.error(error);
    } finally {
      setIsAutoMatching(false);
    }
  };

  // Get suggested matches for a menu item
  const getSuggestedMatches = (menuItem: BOMMenuItem) => {
    return quProducts
      .map(product => ({
        product,
        score: Math.max(
          fuzzyMatch(menuItem.clean_name || '', product.name),
          fuzzyMatch(menuItem.r365_name, product.name)
        )
      }))
      .filter(({ score }) => score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  };

  // Filter menu items
  const filteredItems = menuItems.filter(item => {
    if (searchTerm && !item.r365_name.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    if (showUnmatchedOnly && item.qubeyond_item_id) {
      return false;
    }
    return true;
  });

  const matchedCount = menuItems.filter(i => i.qubeyond_item_id).length;
  const unmatchedCount = menuItems.length - matchedCount;

  if (isLoading) {
    return <div className="p-4 text-muted-foreground">Loading menu items...</div>;
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
          <Badge variant="outline" className="text-sm bg-blue-500/10">
            {quProducts.length} QU products
          </Badge>
        </div>
        
        <Button 
          onClick={fetchQuProducts} 
          disabled={isFetchingQu}
          size="sm"
          variant="outline"
        >
          {isFetchingQu ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Fetch QU Products
        </Button>
        
        <Button 
          onClick={runAutoMatch} 
          disabled={isAutoMatching || unmatchedCount === 0 || quProducts.length === 0}
          size="sm"
        >
          <Wand2 className="h-4 w-4 mr-2" />
          {isAutoMatching ? 'Matching...' : 'Auto-Match'}
        </Button>
      </div>

      {/* Search */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search menu items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <Button
          variant={showUnmatchedOnly ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowUnmatchedOnly(!showUnmatchedOnly)}
        >
          Unmatched Only
        </Button>
      </div>

      {/* Menu Items List */}
      <ScrollArea className="h-[400px] border rounded-lg">
        <div className="divide-y">
          {filteredItems.map((menuItem) => (
            <div 
              key={menuItem.id} 
              className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 hover:bg-muted/50"
            >
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm truncate block">
                  {menuItem.r365_name}
                </span>
                {menuItem.qubeyond_item_id && (
                  <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
                    <Check className="h-3 w-3" />
                    <span>→ {menuItem.qubeyond_item_id}</span>
                  </div>
                )}
              </div>
              
              <QuProductPicker
                menuItem={menuItem}
                quProducts={quProducts}
                getSuggestedMatches={getSuggestedMatches}
                onMatch={(quProductName) => {
                  updateMatch.mutate({
                    menuItemId: menuItem.id,
                    quProductName,
                  });
                }}
              />
            </div>
          ))}
          
          {filteredItems.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              No menu items found
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// Picker component for matching to QU products
function QuProductPicker({
  menuItem,
  quProducts,
  getSuggestedMatches,
  onMatch,
}: {
  menuItem: BOMMenuItem;
  quProducts: QuProduct[];
  getSuggestedMatches: (item: BOMMenuItem) => { product: QuProduct; score: number }[];
  onMatch: (quProductName: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  
  const suggestedMatches = useMemo(() => getSuggestedMatches(menuItem), [menuItem, getSuggestedMatches]);
  
  const filteredProducts = useMemo(() => {
    if (!search) return [];
    const lower = search.toLowerCase();
    return quProducts.filter(p => 
      p.name.toLowerCase().includes(lower)
    ).slice(0, 20);
  }, [search, quProducts]);
  
  return (
    <div className="flex items-center gap-2 shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-[200px] justify-start text-xs h-8"
          >
            {menuItem.qubeyond_item_id ? (
              <span className="truncate flex items-center gap-1">
                <Check className="h-3 w-3 text-green-600 shrink-0" />
                {menuItem.qubeyond_item_id}
              </span>
            ) : (
              <span className="text-muted-foreground">Search QU products...</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput 
              placeholder="Search QU products..." 
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {quProducts.length === 0 
                  ? "Fetch QU products first" 
                  : "No products found"}
              </CommandEmpty>
              
              {/* Suggested matches */}
              {!search && suggestedMatches.length > 0 && (
                <CommandGroup heading="Suggested Matches">
                  {suggestedMatches.map(({ product, score }) => (
                    <CommandItem
                      key={product.name}
                      value={product.name}
                      onSelect={() => {
                        onMatch(product.name);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <Sparkles className="h-3 w-3 text-yellow-500 shrink-0" />
                        <span className="flex-1 truncate">{product.name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {Math.round(score * 100)}%
                        </Badge>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              
              {/* Search results */}
              {search && filteredProducts.length > 0 && (
                <CommandGroup heading="Search Results">
                  {filteredProducts.map((product) => (
                    <CommandItem
                      key={product.name}
                      value={product.name}
                      onSelect={() => {
                        onMatch(product.name);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="truncate">{product.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {product.quantity} sold
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              
              {/* Clear option */}
              {menuItem.qubeyond_item_id && (
                <CommandGroup>
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      onMatch(null);
                      setOpen(false);
                      setSearch('');
                    }}
                    className="text-destructive"
                  >
                    <X className="h-3 w-3 mr-2" />
                    Remove match
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
