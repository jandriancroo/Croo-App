import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { SixDigitPinPrompt } from './SixDigitPinPrompt';

const tap = (keys: string) => keys.split('').forEach((k) => fireEvent.click(screen.getByRole('button', { name: k })));
const save = () => screen.getByRole('button', { name: /save pin/i }) as HTMLButtonElement;

function setup(props: Partial<React.ComponentProps<typeof SixDigitPinPrompt>> = {}) {
  const onSaved = vi.fn();
  const onAbandon = vi.fn();
  const onLocked = vi.fn();
  render(
    <SixDigitPinPrompt firstName="Alex" currentPin="4821" token={'a'.repeat(48)} isDayMode
      onSaved={onSaved} onAbandon={onAbandon} onLocked={onLocked} {...props} />,
  );
  return { onSaved, onAbandon, onLocked };
}

describe('SixDigitPinPrompt', () => {
  beforeEach(() => rpc.mockReset());

  it('shows the blocking prompt with no skip or close', () => {
    setup();
    expect(screen.getByText('Please update to a six-digit PIN to enhance security.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /skip|later|close|cancel/i })).toBeNull();
  });

  it('keeps Save grayed until both boxes match, then saves and calls onSaved', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null });
    const { onSaved } = setup();
    tap('815263');
    expect(save().disabled).toBe(true);
    tap('815264');
    expect(save().disabled).toBe(true);
    expect(screen.getByText("PINs don't match.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    tap('3');
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith('punch_clock_set_six_digit_pin', { _token: 'a'.repeat(48), _pin: '815263' });
  });

  it('stops each box at 6 digits', () => {
    setup();
    tap('815263');
    tap('81526399');
    expect(save().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'New PIN' }));
    tap('77');
    expect(save().disabled).toBe(false);
  });

  it('adds two digits to the end or the front of the current PIN', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my PIN, add 2 digits' }));
    tap('57');
    tap('482157');
    fireEvent.click(save());
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('punch_clock_set_six_digit_pin', expect.objectContaining({ _pin: '482157' })));

    fireEvent.click(screen.getByRole('button', { name: 'Keep my PIN, add 2 digits' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to front' }));
    tap('57');
    tap('574821');
    fireEvent.click(save());
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('punch_clock_set_six_digit_pin', expect.objectContaining({ _pin: '574821' })));
  });

  it('shows the server rejection and clears the boxes', async () => {
    rpc.mockResolvedValue({ data: { success: false, code: 'rejected', error: 'Pick a different PIN. Avoid easy patterns like 123456.' }, error: null });
    const { onSaved } = setup();
    tap('123456');
    tap('123456');
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText('Pick a different PIN. Avoid easy patterns like 123456.')).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
    expect(save().disabled).toBe(true);
  });

  it('hands a lockout back to the clock', async () => {
    rpc.mockResolvedValue({ data: { success: false, code: 'locked', retry_after_seconds: 90 }, error: null });
    const { onLocked } = setup();
    tap('815263');
    tap('815263');
    fireEvent.click(save());
    await waitFor(() => expect(onLocked).toHaveBeenCalledWith(90));
  });
});
