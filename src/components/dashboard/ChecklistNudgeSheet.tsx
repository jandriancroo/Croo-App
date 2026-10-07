import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SmartFieldEditor } from '@/components/templates/SmartFieldEditor';
import { NUDGE_FIELDS } from '@/lib/smartFields';
import { getNudgeOptions, sendChecklistNudge, renderNudgeText, NUDGE_ICON, NUDGE_MAX_MESSAGE, nameList } from '@/lib/checklistNudges';

interface Props {
  target: { id: string; title: string } | null;
  onClose: () => void;
  onSent?: () => void;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

export function ChecklistNudgeSheet({ target, onClose, onSent }: Props) {
  const NudgeIcon = NUDGE_ICON;
  const open = !!target;
  const { data, isLoading, error } = useQuery({
    queryKey: ['checklist-nudge-options', target?.id],
    queryFn: () => getNudgeOptions(target!.id),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  const templates = useMemo(() => {
    const list = data?.templates || [];
    return [...list].sort((a, b) => Number(b.is_default) - Number(a.is_default));
  }, [data]);

  const [message, setMessage] = useState('');
  const [templateIdx, setTemplateIdx] = useState(0);
  const [loadedBody, setLoadedBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) { setMessage(''); setLoadedBody(''); setTemplateIdx(0); return; }
    if (templates.length && !loadedBody) {
      setTemplateIdx(0);
      setMessage(templates[0].body);
      setLoadedBody(templates[0].body);
    }
  }, [open, templates, loadedBody]);

  const pickTemplate = (i: number) => {
    if (i === templateIdx) return;
    if (message !== loadedBody && !window.confirm('Replace your edited message with this template?')) return;
    setTemplateIdx(i);
    setMessage(templates[i].body);
    setLoadedBody(templates[i].body);
  };

  const first = data?.going[0];
  const fields = data ? { sender_first_name: data.sender_first_name, checklist: data.checklist.title, done: data.checklist.done, total: data.checklist.total } : null;
  const previewText = fields ? renderNudgeText(message, { ...fields, recipient_first_name: first?.first_name }) : '';
  const tooLong = message.length > NUDGE_MAX_MESSAGE;
  const empty = !message.trim();

  const send = async () => {
    if (!target || !data) return;
    setSending(true);
    const tpl = templates[templateIdx];
    const res = await sendChecklistNudge({ checklistId: target.id, message, templateId: tpl?.id ?? null, source: 'dashboard' });
    setSending(false);
    if (res.ok !== true) { toast.error((res as { error: string }).error); return; }
    toast.success(`Nudged ${nameList(res.sent.map((p) => p.name.split(' ')[0]))}`);
    onSent?.();
    onClose();
  };

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent className="max-h-[92vh]">
        <div className="mx-auto w-full max-w-lg overflow-y-auto">
          <DrawerHeader className="text-left">
            <DrawerTitle className="flex items-center gap-2">
              <NudgeIcon className="h-5 w-5 text-primary" /> Nudge the crew
            </DrawerTitle>
            <DrawerDescription>
              {data ? `${data.checklist.title} · ${data.checklist.done} of ${data.checklist.total} done` : target?.title}
            </DrawerDescription>
          </DrawerHeader>

          <div className="space-y-5 px-4 pb-2">
            {isLoading && (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            )}
            {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
            {data && !data.allowed && <p className="text-sm text-muted-foreground">{data.reason}</p>}

            {data && data.allowed && (
              <>
                <section className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold">Going to · everyone on the clock</h3>
                    <span className="text-xs text-muted-foreground">{data.going.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.going.map((p) => (
                      <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-xs font-medium">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{initials(p.name)}</span>
                        {p.name}
                      </span>
                    ))}
                  </div>
                  {data.recently.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Skipped, nudged recently: {data.recently.map((p) => `${p.name.split(' ')[0]} (${p.minutes_ago}m ago)`).join(', ')}
                    </p>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Message</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((t, i) => (
                      <button
                        key={`${t.id ?? 'd'}-${i}`}
                        type="button"
                        onClick={() => pickTemplate(i)}
                        className={cn(
                          'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
                          i === templateIdx ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground'
                        )}
                      >
                        {t.is_default && <Star className="h-3 w-3 fill-current" />}
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <SmartFieldEditor
                    value={message}
                    onChange={setMessage}
                    fields={NUDGE_FIELDS}
                    multiline={false}
                    maxLength={NUDGE_MAX_MESSAGE}
                    ariaLabel="Nudge message"
                  />
                  <p className="text-xs text-muted-foreground">Only changes this nudge</p>
                </section>

                {first && (
                  <section className="space-y-2">
                    <p className="text-sm"><span className="font-semibold">{first.first_name || first.name} will see:</span> {previewText}</p>
                    <div className="rounded-xl border border-border bg-muted/40 p-3">
                      <div className="text-sm font-semibold">{data.sender_first_name}</div>
                      <div className="text-sm text-muted-foreground line-clamp-3">{previewText}</div>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          <DrawerFooter>
            {data?.allowed ? (
              <Button onClick={send} disabled={sending || empty || tooLong} className="h-12 gap-2 text-base font-semibold">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <NudgeIcon className="h-4 w-4" />}
                Send nudge to {data.going.length}
              </Button>
            ) : (
              <Button variant="outline" onClick={onClose}>Close</Button>
            )}
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
