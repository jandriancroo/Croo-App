import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag, ChevronDown, ChevronRight, CheckCircle2, Clock, Archive, RefreshCw } from "lucide-react";

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
}

export default function BrandCatalogSection({
  category, items, onEdit, onStatusChange,
  selectionMode, selectedIds, onToggleSelect,
}: BrandCatalogSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const recipeCount = items.filter(i => i.is_recipe).length;

  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-semibold text-sm">{category}</span>
        <Badge variant="secondary" className="text-[10px] tabular-nums">
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
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              className="w-full flex items-center gap-2 py-1.5 px-2 text-sm hover:bg-muted/50 transition-colors text-left rounded-sm group"
              onClick={() => {
                if (selectionMode && onToggleSelect) {
                  onToggleSelect(item.id);
                } else {
                  onEdit(item);
                }
              }}
            >
              {selectionMode && selectedIds && (
                <Checkbox
                  checked={selectedIds.has(item.id)}
                  className="flex-shrink-0"
                  onClick={e => e.stopPropagation()}
                  onCheckedChange={() => onToggleSelect?.(item.id)}
                />
              )}
              <span className="truncate flex-1 font-medium">
                {item.common_name || item.product_name}
              </span>
              {item.common_name && (
                <span className="text-xs text-muted-foreground truncate max-w-[200px] hidden sm:inline">
                  {item.product_name}
                </span>
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
              {item.product_group_name && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">
                  POS ✓
                </Badge>
              )}
              {/* Hover-reveal status actions (hidden during selection mode) */}
              {!selectionMode && (
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                  {item.status === 'draft' && (
                    <button
                      className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      title="Publish (Live)"
                      onClick={() => onStatusChange(item.id, 'live')}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {item.status === 'live' && (
                    <button
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Revert to Draft"
                      onClick={() => onStatusChange(item.id, 'draft')}
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {item.status !== 'archived' && (
                    <button
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Archive"
                      onClick={() => onStatusChange(item.id, 'archived')}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {item.status === 'archived' && (
                    <button
                      className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      title="Restore to Live"
                      onClick={() => onStatusChange(item.id, 'live')}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
