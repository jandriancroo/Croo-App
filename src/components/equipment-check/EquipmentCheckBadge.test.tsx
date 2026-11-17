import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EquipmentCheckBadge, EquipmentCheckBanner } from './EquipmentCheckBadge';
import { openAlert, recentlyAcknowledged } from '@/hooks/useEquipmentChecks';

const alert = {
  id: 'a1', location_id: 'l1', item_id: 'i1', unit_name: 'TEMP - Walk-In Cooler', location_name: 'Sparks',
  equipment_type: 'walk_in', timezone: 'America/Los_Angeles', created_at: '2026-11-17T16:06:00Z',
  readings: [{ temp: 46.2, at: '2026-11-16T22:10:00Z' }, { temp: 44.8, at: '2026-11-17T16:05:00Z' }],
  acknowledged_by: null, acknowledged_by_name: null, acknowledged_at: null,
};

describe('equipment-check badge', () => {
  it('shows unit, store, both failed readings, safe range, tip and Acknowledge', async () => {
    const onAck = vi.fn().mockResolvedValue({});
    render(<EquipmentCheckBadge alert={alert} onAcknowledge={onAck} />);
    expect(screen.getByText('Please check equipment')).toBeInTheDocument();
    expect(screen.getByText('TEMP - Walk-In Cooler · Sparks')).toBeInTheDocument();
    expect(screen.getByText('46.2°F')).toBeInTheDocument();
    expect(screen.getByText('Mon Nov 16, 2:10 PM')).toBeInTheDocument();
    expect(screen.getByText('44.8°F')).toBeInTheDocument();
    expect(screen.getByText('Safe range for walk-ins: 30–41°F')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge/ }));
    await waitFor(() => expect(onAck).toHaveBeenCalledWith('a1'));
  });

  it('after acknowledgment: no badge, banner says who and when', () => {
    const acked = { ...alert, acknowledged_by: 'u1', acknowledged_by_name: 'Jose', acknowledged_at: new Date().toISOString() };
    expect(openAlert([acked])).toBeNull();
    expect(recentlyAcknowledged([acked])).toHaveLength(1);
    render(<EquipmentCheckBanner alert={acked} />);
    expect(screen.getByText(/TEMP - Walk-In Cooler being checked/)).toBeInTheDocument();
    expect(screen.getByText(/Acknowledged by Jose/)).toBeInTheDocument();
  });
});
