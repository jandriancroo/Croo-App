import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TempRetakeTip } from './TempRetakeTip';
import { tempCoachingTip } from '@/lib/temperatureCoaching';

describe('unclear thermometer photo tip', () => {
  it('maps each coaching reason to a short tip', () => {
    expect(tempCoachingTip('too_far')).toMatch(/Move closer so the numbers fill more of the photo/);
    expect(tempCoachingTip('too_dark')).toMatch(/Add light/);
    expect(tempCoachingTip('glare')).toMatch(/glare/);
    expect(tempCoachingTip('blurry')).toMatch(/Hold steady/);
  });
  it('unknown or missing reasons fall back to the focus tip', () => {
    expect(tempCoachingTip('<img src=x>')).toBe(tempCoachingTip('blurry'));
    expect(tempCoachingTip(undefined)).toBe(tempCoachingTip('blurry'));
  });
  it('renders the tip as plain text with a Retake button', () => {
    render(<TempRetakeTip tip={tempCoachingTip('too_far')} onRetake={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't read that photo");
    expect(screen.getByText(/Move closer/)).toBeInTheDocument();
    expect(screen.getByText('Retake')).toBeInTheDocument();
  });
  it('shows Uploading… instead of Retake while a retake uploads', () => {
    render(<TempRetakeTip tip="x" uploading onRetake={vi.fn()} />);
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(screen.queryByText('Retake')).toBeNull();
  });
});
