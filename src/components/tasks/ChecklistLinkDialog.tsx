import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, CircleDashed, ExternalLink, Shield, User } from 'lucide-react';
import { RecipeViewer } from '@/components/library/RecipeViewer';
import { getDateInTimezone } from '@/utils/timezoneUtils';
import type { ChecklistLinkRef } from '@/lib/checklistLinks';

interface Props {
  linkRef: ChecklistLinkRef | null;
  onClose: () => void;
  locationId?: string | null;
  timezone?: string;
}

/**
 * Popover host for a tapped checklist link chip. Opens on top of the checklist
 * so the user never loses their place. Read-only / reference — completing the
 * checklist item is still a deliberate manual check-off.
 */
export function ChecklistLinkDialog({ linkRef, onClose, locationId, timezone }: Props) {
  if (!linkRef) return null;

  if (linkRef.type === 'recipe') {
    return (
      <RecipeViewer
        open
        onOpenChange={(o) => !o && onClose()}
        recipeId={linkRef.id}
        canEdit={false}
      />
    );
  }

  if (linkRef.type === 'log') {
    return <LogLinkDialog linkRef={linkRef} onClose={onClose} locationId={locationId} timezone={timezone} />;
  }

  return <PersonLinkDialog linkRef={linkRef} onClose={onClose} locationId={locationId} />;
}

/** Shows today's status for a linked log type, read-only, with a jump-out option. */
function LogLinkDialog({ linkRef, onClose, locationId, timezone }: Props & { linkRef: ChecklistLinkRef }) {
  const navigate = useNavigate();
  const today = getDateInTimezone(new Date(), timezone || 'America/Los_Angeles');

  const { data, isLoading } = useQuery({
    queryKey: ['checklist-link-log', linkRef.id, locationId, today],
    queryFn: async () => {
      const [{ data: fields }, { data: entry }] = await Promise.all([
        supabase
          .from('logbook_fields')
          .select('id, field_name, field_type, display_order')
          .eq('category_id', linkRef.id)
          .order('display_order'),
        supabase
          .from('logbook_entries')
          .select(
            'id, entry_date, created_at, logbook_entry_values(field_id, value_text, value_number, value_date), profiles(full_name, profile_photo_url)'
          )
          .eq('category_id', linkRef.id)
          .eq('entry_date', today)
          .maybeSingle(),
      ]);
      return { fields: fields ?? [], entry: entry ?? null };
    },
    enabled: !!linkRef.id,
  });

  const entry: any = data?.entry;
  const valueMap = new Map<string, any>(
    (entry?.logbook_entry_values ?? []).map((v: any) => [v.field_id, v])
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{linkRef.label}</DialogTitle>
          <DialogDescription>Today's log — {today}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-md" />
            <Skeleton className="h-10 rounded-md" />
          </div>
        ) : entry ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 border-green-600/40 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3" /> Logged
              </Badge>
              {entry.profiles && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={entry.profiles.profile_photo_url || undefined} />
                    <AvatarFallback className="text-[9px]">
                      {entry.profiles.full_name?.charAt(0) ?? '?'}
                    </AvatarFallback>
                  </Avatar>
                  {entry.profiles.full_name}
                </span>
              )}
            </div>
            <div className="rounded-md border divide-y">
              {(data?.fields ?? []).map((f: any) => {
                const v = valueMap.get(f.id);
                const display =
                  v?.value_text ?? (v?.value_number != null ? String(v.value_number) : v?.value_date ?? '—');
                return (
                  <div key={f.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{f.field_name}</span>
                    <span className="font-medium text-right break-words">{display}</span>
                  </div>
                );
              })}
              {(data?.fields ?? []).length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">Entry recorded.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Badge variant="outline" className="gap-1">
              <CircleDashed className="h-3 w-3" /> Not logged yet today
            </Badge>
            <p className="text-sm text-muted-foreground">
              This log hasn't been filled in for today. Open the LogBook to record it — your checklist progress is
              saved as you go.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => navigate(`/logbook?category=${encodeURIComponent(linkRef.label)}`)}
            >
              <ExternalLink className="h-4 w-4 mr-2" /> Open in LogBook
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Shows who is tagged for a training step — a person or everyone in a role. */
function PersonLinkDialog({ linkRef, onClose, locationId }: Props & { linkRef: ChecklistLinkRef }) {
  const { data: roleMembers = [], isLoading } = useQuery({
    queryKey: ['checklist-link-role', linkRef.id, locationId],
    queryFn: async () => {
      const { data: userLocs } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', locationId!);
      const ids = (userLocs ?? []).map((u: any) => u.user_id);
      if (ids.length === 0) return [];
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('user_id', ids)
        .eq('role', linkRef.id as any);
      const roleIds = (roles ?? []).map((r: any) => r.user_id);
      if (roleIds.length === 0) return [];
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', roleIds)
        .eq('is_active', true)
        .order('full_name');
      return profs ?? [];
    },
    enabled: linkRef.type === 'role' && !!locationId,
  });

  const { data: person } = useQuery({
    queryKey: ['checklist-link-user', linkRef.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url, position')
        .eq('id', linkRef.id)
        .maybeSingle();
      return data;
    },
    enabled: linkRef.type === 'user',
  });

  const people: any[] = linkRef.type === 'role' ? roleMembers : person ? [person] : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {linkRef.type === 'role' ? <Shield className="h-4 w-4" /> : <User className="h-4 w-4" />}
            {linkRef.label}
          </DialogTitle>
          <DialogDescription>
            {linkRef.type === 'role'
              ? 'Anyone with this role at your location can sign this step off with you.'
              : 'Tagged for this training step.'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-12 rounded-md" />
        ) : people.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody at this location currently matches.</p>
        ) : (
          <div className="space-y-2">
            {people.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={p.profile_photo_url || undefined} />
                  <AvatarFallback className="text-[10px]">{p.full_name?.charAt(0) ?? '?'}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{p.full_name}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
