import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { BookOpen, ClipboardList, Shield, User, AtSign } from 'lucide-react';
import { useCurrentBrandId } from '@/hooks/useLibrary';
import {
  MENTION_CATEGORIES,
  MENTIONABLE_ROLES,
  addLinkRef,
  findActiveMention,
  removeLinkRef,
  roleLabel,
  type ChecklistLinkRef,
  type ChecklistLinkType,
  type MentionCategory,
} from '@/lib/checklistLinks';
import { ChecklistLinkChips } from '@/components/tasks/ChecklistLinkChips';

interface Props {
  value: string;
  onChange: (value: string) => void;
  refs: ChecklistLinkRef[];
  onRefsChange: (refs: ChecklistLinkRef[]) => void;
  locationId?: string | null;
  placeholder?: string;
  required?: boolean;
  /** Render as an auto-growing Textarea instead of a single-line Input */
  multiline?: boolean;
  rows?: number;
  /** Class applied to the field itself */
  className?: string;
  /** Class applied to the wrapper (field + chips) */
  wrapperClassName?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFieldFocus?: () => void;
  onFieldBlur?: () => void;
  /** Extra DOM attributes forwarded to the field (e.g. data-* hooks) */
  fieldProps?: Record<string, any>;
}

interface TargetOption {
  id: string;
  label: string;
  sublabel?: string;
  photo?: string | null;
}

/**
 * Checklist item text field with `@` deep-link authoring.
 *
 * Typing `@` opens a picker: first choose a category (Recipes / Logs / Team
 * Member / Role), then search within it. Selecting a target inserts a readable
 * `@Label` into the text and records a structured ref alongside it.
 */
export function ChecklistMentionInput({
  value,
  onChange,
  refs,
  onRefsChange,
  locationId,
  placeholder,
  required,
  multiline,
  rows = 1,
  className,
  wrapperClassName,
  onKeyDown,
  onFieldFocus,
  onFieldBlur,
  fieldProps,
}: Props) {
  const inputRef = useRef<any>(null);
  const [open, setOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [category, setCategory] = useState<MentionCategory | null>(null);
  const [search, setSearch] = useState('');
  const brandId = useCurrentBrandId();

  const closePicker = () => {
    setOpen(false);
    setCategory(null);
    setMentionStart(null);
    setSearch('');
  };

  // ---- Target data (only fetched once a category is chosen) ----
  const { data: recipes = [] } = useQuery({
    queryKey: ['mention-recipes', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('library_documents' as any)
        .select('id, title, category, doc_type, brand_id')
        .eq('doc_type', 'recipe')
        .order('title')
        .limit(300);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: open && category?.type === 'recipe',
    staleTime: 5 * 60 * 1000,
  });

  const { data: logCategories = [] } = useQuery({
    queryKey: ['mention-log-categories', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('logbook_categories')
        .select('id, name')
        .eq('location_id', locationId!)
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && category?.type === 'log' && !!locationId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['mention-team', locationId],
    queryFn: async () => {
      const { data: userLocs } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', locationId!);
      const ids = (userLocs ?? []).map((u: any) => u.user_id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', ids)
        .eq('is_active', true)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && category?.type === 'user' && !!locationId,
    staleTime: 5 * 60 * 1000,
  });

  const options: TargetOption[] = useMemo(() => {
    switch (category?.type) {
      case 'recipe':
        return recipes.map((r: any) => ({ id: r.id, label: r.title, sublabel: r.category ?? undefined }));
      case 'log':
        return logCategories.map((c: any) => ({ id: c.id, label: c.name }));
      case 'user':
        return teamMembers.map((p: any) => ({
          id: p.id,
          label: p.full_name || 'Unnamed',
          photo: p.profile_photo_url,
        }));
      case 'role':
        return MENTIONABLE_ROLES.map((r) => ({ id: r, label: roleLabel(r) }));
      default:
        return [];
    }
  }, [category?.type, recipes, logCategories, teamMembers]);

  // ---- Detect `@` while typing ----
  const handleChange = (next: string) => {
    onChange(next);
    const el = inputRef.current;
    const caret = el?.selectionStart ?? next.length;
    const active = findActiveMention(next, caret);
    if (active) {
      setMentionStart(active.start);
      // Pre-select the category if the author typed a recognized keyword
      const matched = MENTION_CATEGORIES.find(
        (c) => active.query.length > 0 && c.key.startsWith(active.query.toLowerCase())
      );
      setCategory(active.query.length > 0 && matched && matched.key === active.query.toLowerCase() ? matched : null);
      setOpen(true);
    } else if (open) {
      closePicker();
    }
  };

  const pickTarget = (opt: TargetOption) => {
    if (!category) return;
    const ref: ChecklistLinkRef = { type: category.type, id: opt.id, label: opt.label };
    onRefsChange(addLinkRef(refs, ref));

    // Replace the raw `@fragment` in the text with a readable `@Label `
    const start = mentionStart;
    if (start !== null) {
      const el = inputRef.current;
      const caret = el?.selectionStart ?? value.length;
      const next = `${value.slice(0, start)}@${opt.label} ${value.slice(caret)}`;
      onChange(next);
      requestAnimationFrame(() => {
        const pos = start + opt.label.length + 2;
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    }
    closePicker();
  };

  // Reset search when switching categories
  useEffect(() => {
    setSearch('');
  }, [category?.type]);

  const Field: any = multiline ? Textarea : Input;

  return (
    <div className={cn('space-y-1.5', wrapperClassName)}>
      <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : closePicker())}>
        <PopoverAnchor asChild>
          <Field
            ref={inputRef}
            value={value}
            onChange={(e: any) => handleChange(e.target.value)}
            onKeyDown={(e: any) => {
              if (e.key === 'Escape' && open) {
                e.preventDefault();
                closePicker();
                return;
              }
              // While the picker is open, let Enter/arrows belong to the picker
              if (open && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) return;
              onKeyDown?.(e);
            }}
            onFocus={() => onFieldFocus?.()}
            onBlur={() => onFieldBlur?.()}
            placeholder={placeholder}
            required={required}
            className={className}
            {...(multiline ? { rows } : {})}
            {...fieldProps}
          />
        </PopoverAnchor>
        <PopoverContent
          className="w-[min(22rem,calc(100vw-2rem))] p-0"
          align="start"
          side="bottom"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {!category ? (
            <div className="p-1">
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground flex items-center gap-1">
                <AtSign className="h-3 w-3" /> Link something in the app
              </p>
              {MENTION_CATEGORIES.map((c) => {
                const Icon =
                  c.type === 'recipe' ? BookOpen : c.type === 'log' ? ClipboardList : c.type === 'user' ? User : Shield;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c)}
                    className="w-full flex items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent text-left"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1">{c.label}</span>
                    <span className="text-[11px] text-muted-foreground">@{c.key}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Command shouldFilter>
              <CommandInput
                autoFocus
                placeholder={category.placeholder}
                value={search}
                onValueChange={setSearch}
              />
              <CommandList className="max-h-64">
                <CommandEmpty>Nothing found.</CommandEmpty>
                <CommandGroup heading={category.label}>
                  {options.map((opt) => (
                    <CommandItem
                      key={opt.id}
                      value={`${opt.label} ${opt.sublabel ?? ''}`}
                      onSelect={() => pickTarget(opt)}
                      className="gap-2"
                    >
                      {category.type === 'user' ? (
                        <Avatar className="h-5 w-5 shrink-0">
                          <AvatarImage src={opt.photo || undefined} />
                          <AvatarFallback className="text-[9px]">
                            {opt.label.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                      ) : null}
                      <span className="truncate">{opt.label}</span>
                      {opt.sublabel && (
                        <span className="ml-auto text-[11px] text-muted-foreground truncate">{opt.sublabel}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>

      <ChecklistLinkChips refs={refs} onRemove={(r) => onRefsChange(removeLinkRef(refs, r))} />
    </div>
  );
}
