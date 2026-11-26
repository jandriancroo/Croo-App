import { afterEach, describe, expect, it } from 'vitest';
import { PUBLIC_ORIGIN, getPublicOrigin } from './publicOrigin';

type Windowish = { location: { hostname: string; origin: string } };
const g = globalThis as unknown as { window?: Windowish };
const ORIGINAL_WINDOW = g.window;

afterEach(() => {
  g.window = ORIGINAL_WINDOW;
});

describe('getPublicOrigin', () => {
  it('exports the production origin constant', () => {
    expect(PUBLIC_ORIGIN).toBe('https://croohq.com');
  });

  it('keeps croohq.com and its subdomains on their own host', () => {
    const cases: Array<[string, string]> = [
      ['croohq.com', 'https://croohq.com'],
      ['www.croohq.com', 'https://www.croohq.com'],
      ['kiosk.croohq.com', 'https://kiosk.croohq.com'],
    ];
    for (const [host, origin] of cases) {
      g.window = { location: { hostname: host, origin } };
      expect(getPublicOrigin()).toBe(origin);
    }
  });

  it('falls back to production on a preview host, a look-alike host, and off the browser', () => {
    g.window = {
      location: { hostname: 'id-preview--9db37c9a.lovable.app', origin: 'https://id-preview--9db37c9a.lovable.app' },
    };
    expect(getPublicOrigin()).toBe('https://croohq.com');

    g.window = { location: { hostname: 'croohq.com.evil.test', origin: 'https://croohq.com.evil.test' } };
    expect(getPublicOrigin()).toBe('https://croohq.com');

    delete g.window;
    expect(getPublicOrigin()).toBe('https://croohq.com');
  });
});
