import { describe, expect, it } from 'vitest';
import { tourStepDestination } from './tourNavigation';

describe('manual tour navigation', () => {
  it('keeps the opening navigation step on Settings', () => {
    expect(tourStepDestination(0, '/dashboard')).toBeNull();
  });
  it('navigates to Dash when reaching the Data Cubes step', () => {
    expect(tourStepDestination(1, '/dashboard')).toBe('/dashboard');
  });
});