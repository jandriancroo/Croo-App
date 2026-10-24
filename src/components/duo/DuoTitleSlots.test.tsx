import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageTitle } from '@/components/PageTitle';
import { DuoTitleSlotsContext } from './DuoTitleSlots';

vi.mock('@/hooks/useLocation', () => ({ useOptionalLocation: () => null }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 'America/Los_Angeles' }) }));

afterEach(() => { cleanup(); document.body.replaceChildren(); });

describe('Duo title action ownership', () => {
  it('keeps the existing action callback when moved into and out of the Layout slot', () => {
    const left = document.createElement('div');
    const right = document.createElement('div');
    document.body.append(left, right);
    const run = vi.fn();
    const title = <PageTitle color="teal" status={null} duoSlot="right" action={<button onClick={run}>Punch</button>}>Schedule</PageTitle>;
    const view = render(<DuoTitleSlotsContext.Provider value={{ left, right }}>{title}</DuoTitleSlotsContext.Provider>);
    const action = right.querySelector('button');
    if (!action) throw new Error('Missing header action');
    fireEvent.click(action);
    expect(run).toHaveBeenCalledTimes(1);
    view.rerender(<DuoTitleSlotsContext.Provider value={{ left: null, right: null }}>{title}</DuoTitleSlotsContext.Provider>);
    fireEvent.click(view.getByRole('button', { name: 'Punch' }));
    expect(run).toHaveBeenCalledTimes(2);
  });
});