import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AvailabilityDetails, TimeOffRequestDetails } from './BlockedDayDetails';
import { SplitBlockedCell } from './availabilityVisuals';

afterEach(cleanup);
describe('blocked day display', () => {
  it('keeps both triangular layers in one 55px cell with all-request label', () => {
    const { container } = render(<SplitBlockedCell requests={[{ status: 'pending' }, { status: 'approved' }]} />);
    expect(screen.getByRole('button')).toHaveClass('min-h-[55px]');
    expect(screen.getByText('Time Off ×2')).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument();
    expect(container.querySelectorAll('[style*="clip-path"]')).toHaveLength(2);
  });
  it('shows no label in compact mode and preserves its height', () => {
    render(<SplitBlockedCell compact requests={[{ status: 'pending' }]} />);
    expect(screen.getByRole('button')).toHaveClass('min-h-[26px]');
    expect(screen.queryByText('Time Off')).not.toBeInTheDocument();
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument();
  });
  it('shares full availability and multi-day request details', () => {
    render(<><AvailabilityDetails lines={['Unavailable all day']} /><TimeOffRequestDetails request={{ request_type: 'time_off', time_scope: 'multi_day', start_date: '2026-10-09', end_date: '2026-10-12', notes: 'Away', status: 'pending' }} /></>);
    expect(screen.getByText('Weekly Availability')).toBeInTheDocument();
    expect(screen.getByText('Oct 9 - Oct 12')).toBeInTheDocument();
    expect(screen.getByText('Away')).toBeInTheDocument();
  });
});