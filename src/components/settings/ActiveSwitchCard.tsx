import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ActiveStatusBadge } from './ActiveStatusBadge';
import { canConfirmDeactivate, DEACTIVATE_COOLDOWN_SECONDS } from '@/lib/activeSwitch';

interface Props {
  kind: 'location' | 'org';
  id: string;
  name: string;
  isActive: boolean;
  /** Location only: its Org is switched off, so it can't be turned on by itself. */
  orgInactive?: boolean;
  onChanged: (active: boolean) => void;
}

/** Super-admin-only Make Inactive / Make Active control with type-the-name + cool-off countdown. */
export const ActiveSwitchCard = ({ kind, id, name, isActive, orgInactive, onChanged }: Props) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(DEACTIVATE_COOLDOWN_SECONDS);
  const [saving, setSaving] = useState(false);
  const label = kind === 'org' ? 'Org' : 'Location';
  const turningOff = isActive;

  useEffect(() => {
    if (!open || !turningOff) return;
    setTyped('');
    setSecondsLeft(DEACTIVATE_COOLDOWN_SECONDS);
    const t = window.setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(t);
  }, [open, turningOff]);

  const ready = turningOff ? canConfirmDeactivate(typed, name, secondsLeft) : true;

  const run = async () => {
    if (!ready) return;
    setSaving(true);
    const next = !isActive;
    const { error } = kind === 'org'
      ? await supabase.rpc('set_organization_active', { _org_id: id, _active: next })
      : await supabase.rpc('set_location_active', { _location_id: id, _active: next });
    setSaving(false);
    if (error) {
      toast.error(error.message || `Couldn't update this ${label}`);
      return;
    }
    toast.success(next ? `${name} is active again` : `${name} is now inactive`);
    setOpen(false);
    onChanged(next);
  };

  const blockedOn = !isActive && kind === 'location' && orgInactive;

  return (
    <Card className={isActive ? undefined : 'border-destructive/40'}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{label} status</CardTitle>
          <ActiveStatusBadge active={isActive} />
        </div>
        <CardDescription className="text-xs">
          {isActive
            ? `Making this ${label} inactive hides it everywhere and stops its automatic work. Nothing is deleted.`
            : blockedOn
              ? 'This Location is off because its Org is inactive. Turn the Org back on first.'
              : `This ${label} is inactive. Turning it back on brings everything back.`}
          {' '}Only you can see this.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant={isActive ? 'destructive' : 'default'}
          className="w-full"
          disabled={blockedOn}
          onClick={() => setOpen(true)}
        >
          <Power className="mr-2 h-4 w-4" />
          {isActive ? `Make ${label} Inactive` : `Make ${label} Active`}
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {turningOff ? `Make "${name}" inactive?` : `Turn "${name}" back on?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {turningOff ? (
                  <>
                    <p>
                      {kind === 'org'
                        ? 'Every Location in this Org goes dark. Staff who only work here will see a "not active" screen. '
                        : 'It disappears from everyone\'s Location switcher, and staff who only work here will see a "not active" screen. '}
                      Sales pulls, alerts and emails stop. Nothing is deleted.
                    </p>
                    <p>Type <span className="font-semibold text-foreground">{name}</span> to confirm.</p>
                  </>
                ) : (
                  <p>
                    {kind === 'org'
                      ? 'The Org and the Locations that were on before it was switched off come back.'
                      : 'The Location comes back for its staff and its automatic work starts again.'}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {turningOff && (
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={name}
              aria-label={`Type ${name} to confirm`}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <Button
              variant={turningOff ? 'destructive' : 'default'}
              disabled={!ready || saving}
              onClick={run}
            >
              {saving
                ? 'Saving…'
                : turningOff
                  ? secondsLeft > 0 ? `Make Inactive (${secondsLeft})` : 'Make Inactive'
                  : 'Turn On'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
