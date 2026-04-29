import { useState, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { ActiveConversion } from "@/hooks/useBrandConversions";

const isNewItem = (createdAt: string) => {
  const created = new Date(createdAt);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return created > sevenDaysAgo;
};

interface BrandTemplateItem {
  id: string;
  product_name: string;
  common_name: string | null;
  category: string | null;
  is_recipe: boolean;
  status: string;
  product_group_name?: string | null;
  [key: string]: any;
}

interface BrandCatalogSectionProps {
  category: string;
  items: BrandTemplateItem[];
  onEdit: (item: BrandTemplateItem) => void;
  onStatusChange: (id: string, status: string) => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onStartSelection?: (id: string) => void;
  recipeUsageMap?: Map<string, number>;
  conversionMap?: Map<string, ActiveConversion>;
  highlightedItemId?: string | null;
  onItemClick?: (item: BrandTemplateItem) => void;
}

export default function BrandCatalogSection({
  category, items, onEdit, onStatusChange,
  selectionMode, selectedIds, onToggleSelect, onStartSelection, recipeUsageMap,
  conversionMap, highlightedItemId, onItemClick,
}: BrandCatalogSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const recipeCount = items.filter(i => i.is_recipe).length;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const handleTouchStart = useCallback((id: string) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      onStartSelection?.(id);
    }, 500);
  }, [onStartSelection]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const isUncategorized = category === 'Uncategorized';

  return (
    <div>
      <button
        type="button"
        className={`w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left ${
          isUncategorized ? 'bg-amber-500/5 border-l-2 border-amber-500' : ''
        }`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Tag className={`h-3.5 w-3.5 ${isUncategorized ? 'text-amber-500' : 'text-muted-foreground'}`} />
        <span className={`font-semibold text-sm ${isUncategorized ? 'text-amber-700 dark:text-amber-400' : ''}`}>
          {category}
        </span>
        <Badge variant="secondary" className={`text-[10px] tabular-nums ${
          isUncategorized ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : ''
        }`}>
          {items.length} items
        </Badge>
        {recipeCount > 0 && (
          <Badge variant="outline" className="text-[10px] tabular-nums">
            {recipeCount} recipes
          </Badge>
        )}
        <Badge variant="outline" className="ml-auto text-xs tabular-nums">
          {items.length}
        </Badge>
      </button>

      {isOpen && (
        <div className="px-2 pb-2">
          {items.map(item => {
            const conv = conversionMap?.get(item.id);
            const needsReview = !conv || conv.source === 'needs_review';
            const isHighlighted = highlightedItemId === item.id;
            return (
            <div
              key={item.id}
              className={`w-full flex items-center gap-2 py-1.5 px-2 text-sm hover:bg-muted/50 transition-colors text-left rounded-sm group cursor-pointer ${
                selectionMode && selectedIds?.has(item.id) ? 'bg-primary/5' : ''
              } ${isHighlighted ? 'bg-primary/10 border-l-2 border-primary' : ''}`}
              onClick={() => {
                if (longPressTriggered.current) return;
                if (selectionMode && onToggleSelect) {
                  onToggleSelect(item.id);
                } else if (onItemClick) {
                  onItemClick(item);
                } else {
                  onEdit(item);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onStartSelection?.(item.id);
              }}
              onTouchStart={() => handleTouchStart(item.id)}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              {selectionMode && (
                <Checkbox
                  checked={selectedIds?.has(item.id) ?? false}
                  className="flex-shrink-0"
                  onCheckedChange={() => onToggleSelect?.(item.id)}
                />
              )}
              {conversionMap && needsReview && !item.is_recipe && (
                <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0" aria-label="Needs conversion review" />
              )}
              <span className="truncate flex-1 font-medium">
                {item.common_name || item.product_name}
              </span>
              {item.common_name && item.common_name !== item.product_name && (
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                  ({item.product_name})
                </span>
              )}
              {!item.is_recipe && recipeUsageMap && recipeUsageMap.has(item.id) && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
                  {recipeUsageMap.get(item.id)} recipe{recipeUsageMap.get(item.id)! > 1 ? 's' : ''}
                </Badge>
              )}
              {item.is_recipe && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 uppercase tracking-wider">
                  Recipe
                </Badge>
              )}
              {item.status === 'draft' && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
                  Draft
                </Badge>
              )}
              {item.status === 'draft' && item.vendor_source?.startsWith('invoice:') && isNewItem(item.created_at) && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20 font-bold">
                  ⚠️ NEW
                </Badge>
              )}
              {item.source_location_id && item.vendor_source?.startsWith('invoice:') && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 text-muted-foreground">
                  📍 {item.vendor_source.replace('invoice:', '')}
                </Badge>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
