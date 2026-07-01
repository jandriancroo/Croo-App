import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Plus } from "lucide-react";
import { useIngredientSearch, LibraryScope } from "@/hooks/useLibrary";

interface Props {
  scope: LibraryScope;
  brandId: string | null;
  organizationId: string | null;
  value: string;
  onChange: (name: string) => void;
}

export function IngredientCombobox({ scope, brandId, organizationId, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: options = [] } = useIngredientSearch(scope, brandId, organizationId, query);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between">
          <span className={value ? "" : "text-muted-foreground"}>{value || "Pick or create ingredient"}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search ingredients..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              {query.trim() ? (
                <button
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent"
                  onClick={() => { onChange(query.trim()); setOpen(false); }}
                >
                  <Plus className="h-4 w-4" /> Create "{query.trim()}"
                </button>
              ) : "No ingredients yet."}
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.id} value={o.name} onSelect={() => { onChange(o.name); setOpen(false); }}>
                  {o.name}
                </CommandItem>
              ))}
              {query.trim() && !options.some(o => o.name.toLowerCase() === query.trim().toLowerCase()) && (
                <CommandItem value={`__new__${query}`} onSelect={() => { onChange(query.trim()); setOpen(false); }}>
                  <Plus className="h-4 w-4 mr-2" /> Create "{query.trim()}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
