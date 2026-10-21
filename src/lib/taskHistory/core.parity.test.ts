import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('taskHistory browser/edge copies', () => {
  for (const f of ['core.ts', 'helpers.ts', 'schedule.ts']) {
    it(`${f} is byte-identical`, () => {
      const a = readFileSync(path.join(root, 'src/lib/taskHistory', f));
      const b = readFileSync(path.join(root, 'supabase/functions/_shared/taskHistory', f));
      expect(a.equals(b)).toBe(true);
    });
  }
});
