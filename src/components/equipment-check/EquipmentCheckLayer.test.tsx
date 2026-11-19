import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let rows: unknown = null;
let user: { id: string } | null = { id: 'u1' };
let currentLocation: { id: string } | null = { id: 'loc-1' };
const channelNames: string[] = [];
const removed: unknown[] = [];
const filters: string[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user }) }));
vi.mock('@/hooks/useLocation', () => ({ useOptionalLocation: () => ({ currentLocation }) }));
vi.mock('@/integrations/supabase/client', () => {
  const query = {
    select: () => query, eq: () => query, gte: () => query, order: () => query,
    limit: async () => ({ data: rows, error: null }),
  };
  return {
    supabase: {
      from: () => query,
      rpc: async () => ({ data: null, error: null }),
      channel: (name: string) => {
        channelNames.push(name);
        const ch = {
          name,
          on: (_type: string, opts: { filter: string }) => { filters.push(opts.filter); return ch; },
          subscribe: () => ch,
        };
        return ch;
      },
      removeChannel: (ch: unknown) => { removed.push(ch); },
    },
  };
});

import { EquipmentCheckBanners, EquipmentCheckLayer } from './EquipmentCheckLayer';

const alert = {
  id: 'a1', location_id: 'loc-1', item_id: 'i1', unit_name: 'TEMP - Walk-In Cooler', location_name: 'Sparks',
  equipment_type: 'walk_in', timezone: 'America/Los_Angeles', created_at: '2026-11-17T16:06:00Z',
  readings: [{ temp: 46.2, at: '2026-11-16T22:10:00Z' }, { temp: 44.8, at: '2026-11-17T16:05:00Z' }],
  acknowledged_by: null, acknowledged_by_name: null, acknowledged_at: null,
};

const renderChecklistPage = () => render(
  <MemoryRouter initialEntries={['/checklist/c1']}>
    <EquipmentCheckLayer />
    <EquipmentCheckBanners locationId="loc-1" />
  </MemoryRouter>,
);

describe('equipment-check alerts on the checklist page', () => {
  beforeEach(() => {
    rows = null; user = { id: 'u1' }; currentLocation = { id: 'loc-1' };
    channelNames.length = 0; removed.length = 0; filters.length = 0;
  });

  it('cold open with no temps loaded shows nothing and does not throw', async () => {
    const { container } = renderChecklistPage();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Please check equipment')).toBeNull();
  });

  it('cold open with no store or no signed-in user shows nothing and does not subscribe', async () => {
    user = null; currentLocation = null;
    const { container } = render(
      <MemoryRouter initialEntries={['/checklist/c1']}>
        <EquipmentCheckLayer />
        <EquipmentCheckBanners locationId={undefined} />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container).toBeEmptyDOMElement();
    expect(channelNames).toHaveLength(0);
  });

  it('with alerts loaded shows the open-alert badge and the acknowledged banner', async () => {
    rows = [alert, { ...alert, id: 'a2', acknowledged_by: 'u2', acknowledged_by_name: 'Jose', acknowledged_at: new Date().toISOString() }];
    renderChecklistPage();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(screen.getByText('Please check equipment')).toBeInTheDocument());
    expect(screen.getByText(/Acknowledged by Jose/)).toBeInTheDocument();
  });

  it('two mounts at the same time get their own channel names, scoped to the store', async () => {
    const { unmount } = renderChecklistPage();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(channelNames).toHaveLength(2);
    expect(channelNames[0]).not.toBe(channelNames[1]);
    for (const n of channelNames) expect(n).toMatch(/^equipment-checks-loc-1-[a-z0-9]+$/);
    expect(filters).toEqual(['location_id=eq.loc-1', 'location_id=eq.loc-1']);
    unmount();
    expect((removed as { name: string }[]).map((c) => c.name).sort()).toEqual([...channelNames].sort());
  });
});
