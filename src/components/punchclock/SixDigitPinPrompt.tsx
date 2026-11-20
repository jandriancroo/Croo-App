/**
 * Punch-time 6-digit PIN prompt. Blocking, full screen, no skip/close.
 * The punch screen opens only after the server saves the new PIN
 * (punch_clock_set_six_digit_pin). If the kiosk sits idle, it goes back to the
 * PIN keypad without a punch. Never log a PIN.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import {
  SIX,
  applyKey,
  canSaveSixDigit,
  chosenPin,
  mismatchMessage,
  type ExtendSide,
  type UpgradeMode,
} from '@/lib/punchPinUpgrade';

const IDLE_MS = 90 * 1000;

type Field = 'first' | 'confirm';

export interface SixDigitPinPromptProps {
  firstName: string;
  /** The 4-digit PIN just typed; used only to prefill "add 2 digits". */
  currentPin: string;
  token: string | null;
  isDayMode: boolean;
  onSaved: () => void;
  /** Back to the keypad without a punch, with an optional one-line notice. */
  onAbandon: (notice?: string) => void;
  onLocked: (retryAfterSeconds: number) => void;
}

function Boxes({ value, length, active, kept, isDayMode, label, onSelect }: {
  value: string; length: number; active: boolean; kept?: boolean[]; isDayMode: boolean; label: string; onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} className="w-full text-left" aria-label={label}>
      <div className={`text-base font-medium mb-2 ${isDayMode ? 'text-foreground' : 'text-neutral-200'}`}>{label}</div>
      <div className={`flex items-center justify-center gap-2 rounded-xl p-2 border-2 ${active ? 'border-primary' : isDayMode ? 'border-border' : 'border-neutral-700'}`}>
        {Array.from({ length }).map((_, i) => (
          <div
            key={i}
            className={`w-11 h-12 rounded-lg border-2 flex items-center justify-center text-2xl font-bold ${
              i < value.length
                ? kept?.[i]
                  ? isDayMode ? 'bg-muted border-border text-muted-foreground' : 'bg-neutral-700 border-neutral-600 text-neutral-300'
                  : 'bg-primary border-primary text-primary-foreground'
                : isDayMode ? 'bg-muted/50 border-border' : 'bg-neutral-800 border-neutral-600'
            }`}
          >
            {i < value.length ? '•' : ''}
          </div>
        ))}
      </div>
    </button>
  );
}

export function SixDigitPinPrompt({ firstName, currentPin, token, isDayMode, onSaved, onAbandon, onLocked }: SixDigitPinPromptProps) {
  const [mode, setMode] = useState<UpgradeMode>('new');
  const [side, setSide] = useState<ExtendSide>('end');
  const [newPin, setNewPin] = useState('');
  const [added, setAdded] = useState('');
  const [confirm, setConfirm] = useState('');
  const [field, setField] = useState<Field>('first');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lastTapRef = useRef(Date.now());

  // Idle kiosk → back to the keypad (no punch). Also when the server can't start a save.
  useEffect(() => {
    if (!token) {
      const t = window.setTimeout(() => onAbandon('Too many tries. Wait a bit, then enter your 4-digit PIN again.'), 8000);
      return () => window.clearTimeout(t);
    }
    const id = window.setInterval(() => {
      if (!saving && Date.now() - lastTapRef.current > IDLE_MS) onAbandon();
    }, 5000);
    return () => window.clearInterval(id);
  }, [token, saving, onAbandon]);

  const pin = chosenPin(mode, newPin, currentPin, added, side);
  const mismatch = mismatchMessage(pin, confirm);
  const ready = canSaveSixDigit(pin, confirm) && !!token && !saving;

  const resetEntry = (nextMode: UpgradeMode = mode) => {
    setNewPin('');
    setAdded('');
    setConfirm('');
    setField('first');
    setMode(nextMode);
  };

  const press = (key: string) => {
    lastTapRef.current = Date.now();
    if (saving) return;
    setError(null);
    if (field === 'confirm') {
      setConfirm((v) => applyKey(v, key, SIX));
      return;
    }
    if (mode === 'extend') {
      const next = applyKey(added, key, 2);
      setAdded(next);
      if (next.length === 2 && key !== 'back' && key !== 'clear') setField('confirm');
    } else {
      const next = applyKey(newPin, key, SIX);
      setNewPin(next);
      if (next.length === SIX && key !== 'back' && key !== 'clear') setField('confirm');
    }
  };

  const save = async () => {
    lastTapRef.current = Date.now();
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('punch_clock_set_six_digit_pin', { _token: token, _pin: pin });
      if (rpcError) {
        setError("Couldn't save. Try again.");
        return;
      }
      const r = (data ?? {}) as { success?: boolean; code?: string; error?: string; retry_after_seconds?: number };
      if (r.success) {
        onSaved();
        return;
      }
      if (r.code === 'locked') {
        onLocked(Number(r.retry_after_seconds) || 60);
        return;
      }
      if (r.code === 'expired' || r.code === 'not_paired') {
        onAbandon(r.error || 'Enter your 4-digit PIN again.');
        return;
      }
      setError(r.error || 'Pick a different PIN.');
      resetEntry();
    } catch {
      setError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const kept = mode === 'extend'
    ? Array.from({ length: pin.length }, (_, i) => (side === 'end' ? i < 4 : i >= added.length))
    : undefined;
  const text = isDayMode ? 'text-foreground' : 'text-white';
  const muted = isDayMode ? 'text-muted-foreground' : 'text-neutral-400';
  const toggle = (selected: boolean) => (selected ? '' : isDayMode ? '' : 'bg-neutral-700 border-neutral-600 text-white hover:bg-neutral-600 hover:text-white');
  const keyClass = `h-16 text-2xl font-bold rounded-xl border-2 active:scale-95 ${isDayMode ? 'bg-card' : 'bg-neutral-700 border-neutral-600 text-white'}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="six-pin-title"
      className={`fixed inset-0 z-[60] overflow-y-auto ${isDayMode ? 'bg-background' : 'bg-neutral-900'}`}
      style={{ touchAction: 'manipulation' }}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div className={`w-full max-w-lg rounded-2xl border p-5 sm:p-6 space-y-4 ${isDayMode ? 'bg-card border-border' : 'bg-neutral-800 border-neutral-700'}`}>
          <div className="text-center space-y-1">
            <ShieldCheck className="h-8 w-8 mx-auto text-primary" aria-hidden />
            <h2 id="six-pin-title" className={`text-2xl font-bold ${text}`}>Please update to a six-digit PIN to enhance security.</h2>
            <p className={`text-base ${muted}`}>
              {firstName ? `Hi ${firstName}. ` : ''}Your punch goes through right after you save.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="lg" variant={mode === 'new' ? 'default' : 'outline'} className={`h-12 text-base ${toggle(mode === 'new')}`} onClick={() => { lastTapRef.current = Date.now(); setError(null); resetEntry('new'); }}>
              New 6-digit PIN
            </Button>
            <Button type="button" size="lg" variant={mode === 'extend' ? 'default' : 'outline'} className={`h-12 text-base ${toggle(mode === 'extend')}`} onClick={() => { lastTapRef.current = Date.now(); setError(null); resetEntry('extend'); }}>
              Keep my PIN, add 2 digits
            </Button>
          </div>

          {mode === 'extend' && (
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={side === 'front' ? 'default' : 'outline'} className={`h-11 text-base ${toggle(side === 'front')}`} onClick={() => { lastTapRef.current = Date.now(); setSide('front'); setConfirm(''); }}>
                Add to front
              </Button>
              <Button type="button" variant={side === 'end' ? 'default' : 'outline'} className={`h-11 text-base ${toggle(side === 'end')}`} onClick={() => { lastTapRef.current = Date.now(); setSide('end'); setConfirm(''); }}>
                Add to end
              </Button>
            </div>
          )}

          <Boxes
            label={mode === 'extend' ? 'New PIN (your 4 digits + 2 more)' : 'New PIN'}
            value={pin}
            length={SIX}
            kept={kept}
            active={field === 'first'}
            isDayMode={isDayMode}
            onSelect={() => { lastTapRef.current = Date.now(); setField('first'); }}
          />
          <Boxes
            label="Confirm PIN"
            value={confirm}
            length={SIX}
            active={field === 'confirm'}
            isDayMode={isDayMode}
            onSelect={() => { lastTapRef.current = Date.now(); setField('confirm'); }}
          />

          <p role="status" aria-live="polite" className={`min-h-[1.5rem] text-center text-base font-semibold ${error || mismatch ? 'text-destructive' : muted}`}>
            {error ?? mismatch ?? (token ? '' : 'Too many tries. Wait a bit, then enter your 4-digit PIN again.')}
          </p>

          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
              <Button key={k} type="button" variant="outline" size="lg" className={keyClass} onClick={() => press(k)}>{k}</Button>
            ))}
            <Button type="button" variant="ghost" size="lg" className={`h-16 text-base font-medium rounded-xl ${muted}`} onClick={() => press('clear')}>Clear</Button>
            <Button type="button" variant="outline" size="lg" className={keyClass} onClick={() => press('0')}>0</Button>
            <Button type="button" variant="ghost" size="lg" className={`h-16 text-xl rounded-xl ${muted}`} onClick={() => press('back')} aria-label="Delete">⌫</Button>
          </div>

          <Button type="button" size="lg" className="w-full h-14 text-lg font-semibold" disabled={!ready} onClick={save}>
            {saving && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
            {saving ? 'Saving…' : 'Save PIN'}
          </Button>
        </div>
      </div>
    </div>
  );
}
