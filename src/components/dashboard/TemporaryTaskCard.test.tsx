import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarDays } from 'lucide-react';
import { TemporaryTaskCard, readableTextOn } from './TemporaryTaskCard';

vi.mock('./ShareTaskDialog', () => ({ ShareTaskDialog: () => null }));
afterEach(cleanup);
describe('quick task color contrast', () => {
  it('uses WCAG luminance, including short hex and invalid values', () => {
    expect(readableTextOn('#fff')).toBe('#1f2937');
    expect(readableTextOn('#000000')).toBe('#ffffff');
    expect(readableTextOn('#a1a1a1')).toBe('#ffffff');
    expect(readableTextOn('#a2a2a2')).toBe('#1f2937');
    expect(readableTextOn('not a color')).toBe('#ffffff');
  });
  it('keeps an own light color with dark title, tag, share, icon and badge', () => {
    const { container } = render(<TemporaryTaskCard id="t" title="Light task" accentColor="#ffffaa" icon={CalendarDays} onAction={() => {}} taskStyle="alarm" showShare badge={{ label: '3 tasks' }} />);
    expect(screen.getByText('Light task')).toHaveStyle({ color: '#1f2937' });
    expect(screen.getByText('RECURRING')).toHaveStyle({ color: '#1f2937' });
    expect(screen.getByText('3 tasks')).toHaveStyle({ color: 'rgba(31,41,55,0.7)' });
    expect(container.querySelector('.quick-task-card')).toHaveStyle({ backgroundColor: '#ffffaa' });
    expect(container.querySelector('svg')).toHaveStyle({ color: '#1f2937' });
  });
  it('leaves theme-variant cards white regardless of own color', () => {
    render(<TemporaryTaskCard id="t" title="Theme task" accentColor="#ffffaa" variant="system" icon={CalendarDays} onAction={() => {}} />);
    expect(screen.getByText('Theme task')).toHaveStyle({ color: '#ffffff' });
  });
});