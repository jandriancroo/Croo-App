import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ExternalLink } from 'lucide-react';
import { FIELD_META, formatValue, type LaborRulesField } from '@/lib/laborRules/schema';
import { hostOf } from '@/lib/laborRules/lawCheck';

export interface LaborRulesDiffRow {
  field: string;
  current: unknown;
  next: unknown;
  currentSource?: string | null;
  citation?: { url: string; quote?: string; state?: string } | null;
  confidence?: number | null;
  /** Extra line under the row (e.g. "You edited this…"). */
  hint?: string | null;
}

const SOURCE: Record<string, string> = { preset: 'Preset', manual: 'Manual', migration: 'Migration', ai: 'AI' };

interface Props {
  rows: LaborRulesDiffRow[];
  checked?: Set<string>;
  onToggle?: (field: string) => void;
}

/** The one old → new renderer for labor rules (wizard review + law proposals). */
export function LaborRulesDiff({ rows, checked, onToggle }: Props) {
  const selectable = !!checked && !!onToggle;
  return (
    <div className="rounded-lg border divide-y">
      {rows.map((r) => {
        const f = r.field as LaborRulesField;
        const label = FIELD_META[f]?.label ?? r.field;
        return (
          <div key={r.field} className="flex gap-2 px-3 py-2 text-sm">
            {selectable && (
              <Checkbox className="mt-0.5" checked={checked!.has(r.field)} onCheckedChange={() => onToggle!(r.field)} aria-label={`Apply ${label}`} />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">{label}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {r.currentSource && <Badge variant="outline" className="text-[10px]">{SOURCE[r.currentSource] || r.currentSource}</Badge>}
                  <span className="text-muted-foreground">{formatValue(f, r.current)}</span>
                  <span>→</span>
                  <span className="font-medium">{formatValue(f, r.next)}</span>
                </span>
              </div>
              {r.citation?.url && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <a href={r.citation.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                    Source: {hostOf(r.citation.url)} <ExternalLink className="h-3 w-3" />
                  </a>
                  {r.citation.state && <span className="ml-2">{r.citation.state}</span>}
                  {typeof r.confidence === 'number' && <span className="ml-2">{Math.round(r.confidence * 100)}% sure</span>}
                  {r.citation.quote && <p className="italic line-clamp-3">“{r.citation.quote}”</p>}
                </div>
              )}
              {r.hint && <p className="text-xs text-amber-600 dark:text-amber-400">{r.hint}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
