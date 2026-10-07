import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { SmartFieldEditor, SmartFieldPreview } from '@/components/templates/SmartFieldEditor';
import { NUDGE_FIELDS } from '@/lib/smartFields';
import { DEFAULT_NUDGE_TEMPLATES, NUDGE_MAX_MESSAGE, NUDGE_MAX_TEMPLATES, renderNudgeText, worksFor } from '@/lib/quickNudges';

type Row = { id: string | null; name: string; body: string; is_default: boolean; sort_order: number };
type Draft = { index: number | 'new'; name: string; body: string; is_default: boolean };

export function NudgeTemplatesSection({ locationId }: { locationId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = ['nudge-templates', locationId];
  const { data: stored, isLoading } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('location_nudge_templates')
        .select('id, name, body, is_default, sort_order')
        .eq('location_id', locationId)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as Row[];
    },
  });
  const { data: me } = useQuery({
    queryKey: ['nudge-templates-me', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('full_name, nickname').eq('id', user!.id).maybeSingle();
      return (data?.nickname || (data?.full_name || '').split(' ')[0] || 'Jordan') as string;
    },
  });

  const usingDefaults = !isLoading && (stored?.length ?? 0) === 0;
  const rows: Row[] = usingDefaults ? DEFAULT_NUDGE_TEMPLATES.map((t, i) => ({ ...t, sort_order: i })) : stored || [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const sample = (text: string) =>
    renderNudgeText(text, { sender_first_name: me || 'Jordan', recipient_first_name: 'Maria', item: 'Closing Checklist', item_type: 'checklist', event_time: '6:00 PM', done: 5, total: 12 });

  // First save at a store that still uses CrooHQ defaults: write the defaults so they can be customized.
  const ensureStored = async (): Promise<Row[]> => {
    if (!usingDefaults) return rows;
    const { data, error } = await supabase
      .from('location_nudge_templates')
      .insert(DEFAULT_NUDGE_TEMPLATES.map((t, i) => ({ location_id: locationId, name: t.name, body: t.body, is_default: t.is_default, sort_order: i })))
      .select('id, name, body, is_default, sort_order');
    if (error) throw error;
    return ((data || []) as Row[]).sort((a, b) => a.sort_order - b.sort_order);
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const body = draft.body.trim();
    if (!name || name.length > 40) return toast.error('Name must be 1 to 40 characters.');
    if (!body || draft.body.length > NUDGE_MAX_MESSAGE) return toast.error(`Message must be 1 to ${NUDGE_MAX_MESSAGE} characters.`);
    setSaving(true);
    try {
      const list = await ensureStored();
      if (draft.index === 'new') {
        const { error } = await supabase.from('location_nudge_templates').insert({
          location_id: locationId, name, body, is_default: draft.is_default,
          sort_order: Math.max(-1, ...list.map((r) => r.sort_order)) + 1,
        });
        if (error) throw error;
      } else {
        const target = list[draft.index];
        const { error } = await supabase.from('location_nudge_templates')
          .update({ name, body, ...(draft.is_default ? { is_default: true } : {}) })
          .eq('id', target.id!);
        if (error) throw error;
      }
      toast.success('Template saved');
      setDraft(null);
      qc.invalidateQueries({ queryKey: key });
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the template');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: Row) => {
    if (!row.id || row.is_default) return;
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    const { error } = await supabase.from('location_nudge_templates').delete().eq('id', row.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: key });
  };

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Write them in your own voice; the push shows the sender's name. Used for checklists, tasks and events.</p>
      {usingDefaults && <p className="text-xs text-muted-foreground">Using CrooHQ defaults. Save to customize.</p>}

      <div className="space-y-2">
        {rows.map((r, i) =>
          draft && draft.index === i ? (
            <Editor key={i} draft={draft} setDraft={setDraft} onSave={save} saving={saving} sample={sample} canUnsetDefault={!r.is_default} />
          ) : (
            <div key={r.id ?? i} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  {r.is_default && <Badge variant="secondary">Default</Badge>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label="Edit template" onClick={() => setDraft({ index: i, name: r.name, body: r.body, is_default: r.is_default })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {!r.is_default && r.id && (
                    <Button variant="ghost" size="icon" aria-label="Delete template" className="text-destructive hover:text-destructive" onClick={() => remove(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                <SmartFieldPreview text={r.body} fields={NUDGE_FIELDS} />
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Works for: {worksFor(r.body).map((t) => `${t}s`).join(' · ') || 'nothing (uses fields that never go together)'}
              </div>
            </div>
          )
        )}
        {draft?.index === 'new' && (
          <Editor draft={draft} setDraft={setDraft} onSave={save} saving={saving} sample={sample} canUnsetDefault />
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={rows.length >= NUDGE_MAX_TEMPLATES || !!draft}
          onClick={() => setDraft({ index: 'new', name: '', body: '', is_default: false })}
        >
          <Plus className="mr-2 h-4 w-4" /> Add template
        </Button>
        <span className="text-xs text-muted-foreground">{rows.length} of {NUDGE_MAX_TEMPLATES}</span>
      </div>
    </div>
  );
}

function Editor({ draft, setDraft, onSave, saving, sample, canUnsetDefault }: {
  draft: Draft; setDraft: (d: Draft | null) => void; onSave: () => void; saving: boolean; sample: (t: string) => string; canUnsetDefault: boolean;
}) {
  const over = draft.body.length > NUDGE_MAX_MESSAGE;
  return (
    <div className="space-y-3 rounded-lg border border-primary/40 p-3">
      <div className="space-y-1">
        <Label htmlFor="nudge-tpl-name">Name</Label>
        <Input id="nudge-tpl-name" maxLength={40} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Friendly follow-up" />
      </div>
      <div className="space-y-1">
        <Label>Message</Label>
        <SmartFieldEditor
          value={draft.body}
          onChange={(body) => setDraft({ ...draft, body })}
          fields={NUDGE_FIELDS}
          maxLength={NUDGE_MAX_MESSAGE}
          ariaLabel="Nudge template message"
          placeholder="Write the nudge…"
        />
      </div>
      {draft.body.trim() && (
        <div className="rounded-md bg-muted/50 p-2 text-sm">
          <span className="font-semibold">Preview: </span>{sample(draft.body)}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Switch id="nudge-tpl-default" checked={draft.is_default} disabled={!canUnsetDefault && draft.is_default} onCheckedChange={(v) => setDraft({ ...draft, is_default: v })} />
        <Label htmlFor="nudge-tpl-default">Make default</Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
        <Button onClick={onSave} disabled={saving || over || !draft.body.trim() || !draft.name.trim()}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
        </Button>
      </div>
    </div>
  );
}
