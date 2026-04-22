import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { cn } from "@/lib/utils";

interface PosItem {
  name: string;
  category?: string;
  quantity?: number;
}

interface TrackerPosItemPickerProps {
  value: string[];
  onChange: (items: string[]) => void;
  label?: string;
}

export function TrackerPosItemPicker({ value, onChange, label = "Promo Item(s)" }: TrackerPosItemPickerProps) {
  const { currentLocation } = useAppLocation();
  const [search, setSearch] = useState("");

  const selected = useMemo(() => new Set(value.map(item => item.toLowerCase())), [value]);

  const { data: posItems = [], isLoading, isError } = useQuery({
    queryKey: ["tracker-pos-items", currentLocation?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("pos-search", {
        body: { locationId: currentLocation?.id, daysBack: 90 },
      });

      if (error) throw error;
      if (data?.error && !data?.fallback) throw new Error(data.error);

      return ((data?.items || []) as PosItem[]).filter(item => item.name);
    },
    enabled: !!currentLocation?.id,
    staleTime: 10 * 60 * 1000,
  });

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    const items = term
      ? posItems.filter(item => `${item.name} ${item.category || ""}`.toLowerCase().includes(term))
      : posItems;

    return items.slice(0, 80);
  }, [posItems, search]);

  const addItem = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || selected.has(trimmed.toLowerCase())) return;
    onChange([...value, trimmed]);
    setSearch("");
  };

  const removeItem = (name: string) => {
    onChange(value.filter(item => item !== name));
  };

  const canAddTyped = search.trim().length > 0 && !selected.has(search.trim().toLowerCase());

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {value.length > 0 && (
        <div className="flex max-h-14 flex-wrap gap-1 overflow-y-auto pr-1">
          {value.map(item => (
            <Badge key={item} variant="secondary" className="h-6 gap-1 pr-1 text-[10px]">
              <span className="max-w-[150px] truncate">{item}</span>
              <button type="button" onClick={() => removeItem(item)} className="rounded-sm hover:bg-background/70">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="rounded-md border bg-muted/30 p-2">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canAddTyped) {
                event.preventDefault();
                addItem(search);
              }
            }}
            placeholder="Search POS items..."
            className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        <ScrollArea className="mt-1.5 h-[136px] pr-2">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading POS items...
            </div>
          )}

          {isError && <p className="py-6 text-center text-xs text-destructive">POS search is unavailable right now.</p>}

          {!isLoading && !isError && filteredItems.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">No POS items found</p>
          )}

          <div className="space-y-1">
            {!isLoading && !isError && filteredItems.map(item => {
              const isSelected = selected.has(item.name.toLowerCase());
              return (
                <button
                  key={item.name}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-primary/10",
                    isSelected && "bg-primary/10 text-primary"
                  )}
                  onClick={() => isSelected ? removeItem(item.name) : addItem(item.name)}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                  {item.category && <span className="shrink-0 text-[10px] text-muted-foreground">{item.category}</span>}
                  {typeof item.quantity === "number" && <span className="shrink-0 text-[10px] text-muted-foreground">{Math.round(item.quantity)} sold</span>}
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {canAddTyped && (
          <Button type="button" variant="outline" size="sm" className="mt-2 h-8 w-full text-xs" onClick={() => addItem(search)}>
            Add “{search.trim()}”
          </Button>
        )}
      </div>
    </div>
  );
}