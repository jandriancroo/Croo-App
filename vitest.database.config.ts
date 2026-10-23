import { defineConfig } from 'vitest/config';

// SQL regression tests use PostgreSQL in memory, without browser setup or live data.
export default defineConfig({
  test: { environment: 'node', include: ['src/lib/shiftMarketplacePublication.test.ts'] },
});